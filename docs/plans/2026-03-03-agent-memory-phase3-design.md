# Agent Memory Phase 3: Compaction + DAG Integration — Design Document

**Date:** 2026-03-03
**Goal:** Add sqlite-vec for semantic search, decay scoring with tier promotion, LLM-assisted memory compaction, auto-save at task completion, and policy logging.
**Approach:** TS-driven orchestration — Python provides stateless JSON-RPC helpers, TS calls LLM between steps. No protocol changes to the existing unidirectional JSON-RPC.

## Context

Phase 1 built the Python memory service (SQLite + FTS5 store, embedder, retriever, graph, service facade). Phase 2 wired it into the VS Code extension (DagBridge methods, save_memory/recall_memory tools, AGENT_MEMORY system prompt component, auto-retrieve at task start).

What's missing:
- **sqlite-vec**: Embedder generates vectors but `save_embedding()` is a no-op and `_search_semantic()` returns empty
- **Active decay**: `compute_decay_score()` exists in retriever but only applies at query time — doesn't update confidence in DB
- **Tier promotion**: Schema has `tier` field but nothing promotes memories between tiers
- **Compaction**: No merging of related memories
- **Auto-save**: Memories only saved when agent explicitly calls `save_memory`
- **Policy logging**: `policy_log` table exists but is never written to

## Architecture

### TS-Driven Orchestration

TS orchestrates all LLM-requiring operations. Python provides stateless helper methods via existing unidirectional JSON-RPC. No bidirectional protocol needed.

```
MemoryManager (TS)
│
├─ onTaskComplete(taskId, messages)
│   ├─ LLM: extract learnings from conversation
│   ├─ bridge.saveMemory() for each learning
│   ├─ bridge.recordCoChange(changedFiles)
│   └─ bridge.logPolicy() for each decision
│
├─ runCompaction() — triggered on idle timer
│   ├─ bridge.promoteTiers()
│   ├─ bridge.applyDecay()
│   ├─ candidates = bridge.getMergeCandidates()
│   └─ for each group:
│       ├─ LLM: merge candidate memories
│       ├─ bridge.validateMerge(merged, sourceIds)
│       ├─ bridge.commitMerge(merged, sourceIds)
│       └─ bridge.logPolicy()
│
└─ Idle timer: 5 min after last task completion
```

### New Python JSON-RPC Methods

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `memory.promote_tiers` | — | `{promoted: int}` | Run tier promotion rules |
| `memory.apply_decay` | — | `{updated: int}` | Recompute confidence scores |
| `memory.get_merge_candidates` | `{min_jaccard?: float}` | `{groups: [{source_ids, memories, jaccard}]}` | Group by keyword overlap |
| `memory.validate_merge` | `{merged_content, source_ids}` | `{valid: bool, score: float}` | Test retrieval quality |
| `memory.commit_merge` | `{merged_content, source_ids, keywords, type}` | merged MemoryRecord | Archive sources, insert merged |
| `memory.log_policy` | `{decision, memory_id?, context?}` | `{id: int}` | Log policy decision |
| `memory.update_policy_outcome` | `{log_id, outcome}` | — | Update outcome |

### New TS Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `MemoryManager` | `src/core/memory/MemoryManager.ts` | Orchestrates auto-save + compaction |
| DagBridge extensions | `src/services/dag/DagBridge.ts` | New methods for Phase 3 RPC calls |
| TS types | `src/shared/memory-types.ts` | Extended with merge/policy types |

## sqlite-vec Integration

### Store Changes (`store.py`)

On `initialize()`, attempt to load sqlite-vec as a loadable extension:

```python
try:
    self._conn.enable_load_extension(True)
    self._conn.load_extension("vec0")
    self.vec_available = True
except Exception:
    self.vec_available = False
```

Create virtual table if available:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
    embedding float[384],
    memory_id text
);
```

384 dimensions matches the `all-MiniLM-L6-v2` model used by `Embedder`.

### Retriever Changes (`retriever.py`)

`save_embedding()` → INSERT into `memory_vec`:

```python
def save_embedding(self, memory_id: str, embedding: list[float]) -> None:
    if not self.store.vec_available:
        return
    self.store.conn.execute(
        "INSERT INTO memory_vec(embedding, memory_id) VALUES (?, ?)",
        (serialize_float32(embedding), memory_id),
    )
    self.store.conn.commit()
```

`_search_semantic()` → KNN query:

```python
def _search_semantic(self, query_vec: list[float], limit: int = 10):
    if not self.store.vec_available:
        return []
    rows = self.store.conn.execute(
        "SELECT memory_id, distance FROM memory_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
        (serialize_float32(query_vec), limit),
    ).fetchall()
    results = []
    for row in rows:
        record = self.store.get(row["memory_id"])
        if record:
            sim = 1.0 / (1.0 + row["distance"])
            results.append((record, sim))
    return results
```

**Fallback:** If sqlite-vec isn't available, `vec_available = False` and semantic search returns empty. Keyword search still works.

**Dependency:** Add `sqlite-vec` to `pyproject.toml`.

## Decay Scoring + Tier Promotion

### Active Decay (`memory.apply_decay`)

Iterates all non-archived memories, recomputes confidence using the existing `compute_decay_score()` function, and updates the DB:

```python
def apply_decay(self) -> dict:
    records = self.store.list_all(limit=10000)
    updated = 0
    for record in records:
        if record.tier == MemoryTier.ARCHIVED:
            continue
        new_confidence = self.retriever.compute_decay_score(record)
        if abs(new_confidence - record.confidence) > 0.01:
            self.store.update(record.id, confidence=new_confidence)
            updated += 1
    return {"updated": updated}
```

### Tier Promotion Rules (`memory.promote_tiers`)

| From | To | Conditions |
|------|----|-----------|
| `hot` | `warm` | age > 7 days AND access_count < 3 |
| `warm` | `cold` | age > 30 days AND access_count < 1 since last promotion |
| `cold` | `archived` | age > 90 days AND confidence < 0.2 |

Each promotion is logged as a policy decision.

## Compaction (LLM-Assisted Merge)

### Merge Candidate Grouping (`memory.get_merge_candidates`)

1. List all `hot` and `warm` memories
2. Group by keyword overlap: Jaccard similarity > 0.4
3. Filter: same `type` only, generation gap ≤ 1
4. Return groups of 2+ candidates

### TS Compaction Loop

For each group:

1. **LLM merge prompt** (using Haiku — cheapest/fastest):
   ```
   Merge these related memories into a single, concise memory that preserves
   all key information:

   Memory 1: [content]
   Memory 2: [content]

   Output the merged memory as a single paragraph.
   ```

2. **Validate** (`memory.validate_merge`): Python generates 3 synthetic queries from source memories, runs recall against merged memory, checks retrieval quality doesn't drop > 20%

3. **Commit** (`memory.commit_merge`): Archives source memories (tier → archived), inserts merged record with `generation = max(sources) + 1`, adds `EVOLVED_FROM` graph edges

### Triggering

TS `MemoryManager` starts a 5-minute idle timer after last task completion. When it fires:
1. `bridge.promoteTiers()`
2. `bridge.applyDecay()`
3. `getMergeCandidates()` → LLM loop → `commitMerge()`

Compaction is skipped if hot memory count < 20 (not worth the LLM cost).

## Auto-Save at Task Completion

### Flow

1. `AttemptCompletionHandler.execute()` calls `MemoryManager.onTaskComplete(taskId, messages)`
2. Extract last ~20 messages from conversation history
3. Send to LLM (Haiku):
   ```
   Analyze this task conversation and extract reusable learnings. For each:
   - type: one of pattern, error_fix, preference, file_relationship, strategy, fact
   - content: the learning in 1-2 sentences
   - keywords: 3-5 relevant keywords

   Only extract things useful in future tasks. Skip task-specific details.
   Return JSON array: [{type, content, keywords}]
   ```
4. Parse structured response, call `bridge.saveMemory()` for each
5. Get changed files from task, call `bridge.recordCoChange(files)`
6. Log policy decisions

### Guard Rails

- **Max 5 memories per task** — prevent flooding
- **Min 5 messages** — skip very short tasks
- **Dedup check** — before saving, `bridge.recallMemory()` with content; if >0.9 score match exists, skip
- **Configurable** — `beadsmith.memory.autoSave` setting (default: true)

## Policy Logging

### Writing Decisions

`memory.log_policy(decision, memory_id, context)` inserts into the existing `policy_log` table. Decisions: `save`, `skip`, `retrieve`, `compact`.

### Assessing Outcomes

`memory.update_policy_outcome(log_id, outcome)` updates the outcome field.

When outcomes are assessed:
- On `memory.recall()`: if a saved memory is retrieved, mark its save decision as "useful"
- On `memory.apply_decay()`: memories never accessed after 30 days get save decisions marked "not_useful"

This is lightweight tracking for future policy learning (v2). No RL in this phase.

## Dependency Order

```
1. sqlite-vec integration (store + retriever)
2. Decay scoring (apply_decay method)
3. Tier promotion (promote_tiers method)
4. Compaction helpers (get_merge_candidates, validate_merge, commit_merge)
5. Policy logging (log_policy, update_policy_outcome)
6. DagBridge extensions (TS methods for new Python RPCs)
7. MemoryManager (TS orchestration: compaction loop + auto-save)
8. Wire into AttemptCompletionHandler
```

## Testing Strategy

- Python unit tests for each new method (pytest)
- TS unit tests for DagBridge new methods (mock `call()`)
- TS unit tests for MemoryManager (mock DagBridge + LLM)
- Integration test: end-to-end compaction with mock LLM responses
