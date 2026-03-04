"""Memory service facade — single entry point for all memory operations."""

from itertools import combinations
from typing import Any

import structlog

from .embedder import Embedder
from .graph_ext import MemoryGraph
from .models import MemoryRecord, MemoryTier, MemoryType
from .retriever import MemoryRetriever
from .store import MemoryStore

logger = structlog.get_logger()


class MemoryService:
    """Facade coordinating store, retriever, embedder, and graph."""

    def __init__(self, db_path: str) -> None:
        self.store = MemoryStore(db_path)
        self.embedder = Embedder()
        self.retriever: MemoryRetriever | None = None
        self.graph: MemoryGraph | None = None

    def initialize(self) -> None:
        """Initialize all components."""
        self.store.initialize()
        self.retriever = MemoryRetriever(store=self.store, embedder=self.embedder)
        self.graph = MemoryGraph(self.store)
        logger.info("Memory service initialized",
                    embeddings_available=self.embedder.available)

    def save(
        self,
        content: str,
        memory_type: str,
        keywords: list[str],
        source_task: str | None = None,
        source_file: str | None = None,
    ) -> dict[str, Any]:
        """Save a new memory. Returns the saved record as dict."""
        record = MemoryRecord(
            content=content,
            type=MemoryType(memory_type),
            keywords=keywords,
            source_task=source_task,
            source_file=source_file,
        )
        self.store.save(record)

        # Generate and store embedding
        if self.embedder.available and self.retriever:
            vec = self.embedder.embed(content)
            if vec:
                self.retriever.save_embedding(record.id, vec)

        # Add file-memory edge if source_file provided
        if source_file and self.graph:
            self.graph.add_edge(record.id, source_file, "file_memory")

        logger.info("Memory saved", id=record.id, type=memory_type)
        return record.model_dump()

    def recall(
        self,
        query: str,
        top_k: int = 5,
        memory_type: str | None = None,
    ) -> dict[str, Any]:
        """Recall memories matching a query."""
        if self.retriever is None:
            raise RuntimeError("MemoryService not initialized. Call initialize() first.")
        mt = MemoryType(memory_type) if memory_type else None
        response = self.retriever.recall(query, top_k=top_k, memory_type=mt)
        return {
            "results": [
                {
                    "memory": r.memory.model_dump(),
                    "score": r.score,
                    "source": r.source,
                }
                for r in response.results
            ],
            "query": response.query,
            "total_searched": response.total_searched,
        }

    def delete(self, memory_id: str) -> None:
        """Delete a memory."""
        self.store.delete(memory_id)

    def get_stats(self) -> dict[str, Any]:
        """Get memory statistics."""
        stats = self.store.get_stats()
        stats.has_embeddings = self.embedder.available
        return stats.model_dump()

    def get_file_memories(self, file_path: str) -> list[dict[str, Any]]:
        """Get all memories associated with a file."""
        records = self.store.list_by_file(file_path)
        return [r.model_dump() for r in records]

    def record_co_change(self, file_paths: list[str]) -> None:
        """Record co-change relationships between files."""
        if self.graph is None:
            raise RuntimeError("MemoryService not initialized. Call initialize() first.")
        for a, b in combinations(sorted(set(file_paths)), 2):
            self.graph.record_co_change(a, b)

    def get_co_changes(self, file_path: str) -> list[dict[str, Any]]:
        """Get files frequently changed with the given file."""
        if self.graph is None:
            raise RuntimeError("MemoryService not initialized. Call initialize() first.")
        return [{"file": f, "weight": w} for f, w in self.graph.get_co_changes(file_path)]

    def apply_decay(self) -> dict[str, int]:
        """Recompute confidence for all non-archived memories."""
        if self.retriever is None:
            raise RuntimeError("MemoryService not initialized.")
        records = self.store.list_all(limit=10000)
        updated = 0
        for record in records:
            if record.tier == MemoryTier.ARCHIVED:
                continue
            new_confidence = self.retriever.compute_decay_score(record)
            if abs(new_confidence - record.confidence) > 0.01:
                self.store.update(record.id, confidence=new_confidence)
                updated += 1
        logger.info("Decay applied", updated=updated)
        return {"updated": updated}

    def promote_tiers(self) -> dict[str, int]:
        """Run tier promotion rules on all memories."""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        records = self.store.list_all(limit=10000)
        promoted = 0
        for record in records:
            created = datetime.fromisoformat(record.created_at)
            age_days = (now - created).total_seconds() / 86400
            new_tier: MemoryTier | None = None
            if record.tier == MemoryTier.HOT:
                if age_days > 7 and record.access_count < 3:
                    new_tier = MemoryTier.WARM
            elif record.tier == MemoryTier.WARM:
                # Note: checks total access_count, not "since last promotion".
                # A warm memory accessed once when hot will still promote to cold
                # after 30 days of no additional accesses if total access_count < 1.
                if age_days > 30 and record.access_count < 1:
                    new_tier = MemoryTier.COLD
            elif record.tier == MemoryTier.COLD:
                if age_days > 90 and record.confidence < 0.2:
                    new_tier = MemoryTier.ARCHIVED
            if new_tier is not None:
                self.store.update(record.id, tier=new_tier)
                self.log_policy(
                    decision="promote",
                    memory_id=record.id,
                    context=f"Promoted from {record.tier.value} to {new_tier.value}",
                )
                promoted += 1
        logger.info("Tier promotion complete", promoted=promoted)
        return {"promoted": promoted}

    def get_merge_candidates(self, min_jaccard: float = 0.4) -> dict[str, Any]:
        """Group mergeable memories by keyword overlap."""
        eligible: list[MemoryRecord] = []
        for tier in (MemoryTier.HOT, MemoryTier.WARM):
            eligible.extend(self.store.list_all(tier=tier, limit=10000))

        by_type: dict[str, list[MemoryRecord]] = {}
        for mem in eligible:
            by_type.setdefault(mem.type.value, []).append(mem)

        groups: list[dict[str, Any]] = []
        merged_ids: set[str] = set()

        for _, mems in by_type.items():
            for i, a in enumerate(mems):
                if a.id in merged_ids:
                    continue
                group_ids = [a.id]
                group_mems = [a.model_dump()]
                for b in mems[i + 1:]:
                    if b.id in merged_ids:
                        continue
                    if abs(a.generation - b.generation) > 1:
                        continue
                    set_a = set(a.keywords)
                    set_b = set(b.keywords)
                    if not set_a or not set_b:
                        continue
                    jaccard = len(set_a & set_b) / len(set_a | set_b)
                    if jaccard >= min_jaccard:
                        group_ids.append(b.id)
                        group_mems.append(b.model_dump())
                        merged_ids.add(b.id)
                if len(group_ids) >= 2:
                    merged_ids.add(a.id)
                    # Compute average pairwise jaccard
                    total_j = 0.0
                    pairs = 0
                    for gi in range(len(group_ids)):
                        for gj in range(gi + 1, len(group_ids)):
                            mem_gi = next(m for m in eligible if m.id == group_ids[gi])
                            mem_gj = next(m for m in eligible if m.id == group_ids[gj])
                            s1, s2 = set(mem_gi.keywords), set(mem_gj.keywords)
                            if s1 and s2:
                                total_j += len(s1 & s2) / len(s1 | s2)
                            pairs += 1
                    groups.append({
                        "source_ids": group_ids,
                        "memories": group_mems,
                        "jaccard": round(total_j / pairs if pairs else 0.0, 3),
                    })
        return {"groups": groups}

    def validate_merge(self, merged_content: str, source_ids: list[str]) -> dict[str, Any]:
        """Validate a proposed merge by checking retrieval quality."""
        if self.retriever is None:
            raise RuntimeError("MemoryService not initialized.")
        sources = [self.store.get(sid) for sid in source_ids]
        sources = [s for s in sources if s is not None]
        if not sources:
            return {"valid": False, "score": 0.0}

        import json as _json

        conn = self.store._conn
        # Switch to autocommit so we can manage the transaction explicitly.
        # Python sqlite3's conn.commit() releases savepoints, so we must
        # avoid any commit() calls inside the savepoint.  We inline the
        # INSERT and use store.search_keyword() (read-only, no commit)
        # instead of retriever.recall() which would commit via record_access.
        prev_isolation = conn.isolation_level
        conn.isolation_level = None
        conn.execute("BEGIN")
        conn.execute("SAVEPOINT validate_merge")
        try:
            temp_record = MemoryRecord(
                content=merged_content, type=sources[0].type,
                keywords=list({kw for s in sources for kw in s.keywords}),
                source_task="validation",
            )
            # Inline INSERT — store.save() would call conn.commit()
            # and destroy the savepoint.
            conn.execute(
                """INSERT OR REPLACE INTO memories
                   (id, type, content, keywords, source_task, source_file,
                    generation, tier, confidence, access_count, last_accessed_at,
                    created_at, updated_at, evolved_from)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    temp_record.id, temp_record.type.value, temp_record.content,
                    _json.dumps(temp_record.keywords), temp_record.source_task,
                    temp_record.source_file, temp_record.generation,
                    temp_record.tier.value, temp_record.confidence,
                    temp_record.access_count, temp_record.last_accessed_at,
                    temp_record.created_at, temp_record.updated_at,
                    _json.dumps(temp_record.evolved_from),
                ),
            )

            # Test recall quality with source content.
            # Use store.search_keyword() directly (read-only, no commit)
            # instead of retriever.recall() which calls record_access/commit.
            total_score = 0.0
            for sid in source_ids:
                source = self.store.get(sid)
                if source:
                    results = self.store.search_keyword(source.content, limit=5)
                    for record in results:
                        if record.id == temp_record.id:
                            total_score += 1.0
                            break

            avg_score = total_score / max(len(source_ids), 1)
            return {"valid": avg_score > 0.3, "score": round(avg_score, 3)}
        finally:
            conn.execute("ROLLBACK TO SAVEPOINT validate_merge")
            conn.execute("RELEASE SAVEPOINT validate_merge")
            conn.execute("ROLLBACK")
            conn.isolation_level = prev_isolation

    def commit_merge(self, merged_content: str, source_ids: list[str], keywords: list[str], memory_type: str) -> dict[str, Any]:
        """Commit a merge: archive sources, insert merged record, create edges."""
        sources = [self.store.get(sid) for sid in source_ids]
        sources = [s for s in sources if s is not None]
        max_gen = max((s.generation for s in sources), default=0)

        merged = MemoryRecord(
            content=merged_content, type=MemoryType(memory_type),
            keywords=keywords, generation=max_gen + 1, evolved_from=source_ids,
        )
        self.store.save(merged)
        if self.embedder.available and self.retriever:
            vec = self.embedder.embed(merged_content)
            if vec:
                self.retriever.save_embedding(merged.id, vec)
        for source in sources:
            self.store.update(source.id, tier=MemoryTier.ARCHIVED)
        if self.graph:
            for source in sources:
                self.graph.add_edge(merged.id, source.id, "evolved_from")
        logger.info("Merge committed", merged_id=merged.id, sources=len(sources), generation=max_gen + 1)
        return merged.model_dump()

    def log_policy(self, decision: str, memory_id: str | None = None, context: str | None = None) -> dict[str, int]:
        """Log a policy decision."""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.store.conn.execute(
            "INSERT INTO policy_log (decision, memory_id, context, outcome, created_at) VALUES (?, ?, ?, 'pending', ?)",
            (decision, memory_id, context, now),
        )
        self.store.conn.commit()
        logger.info("Policy logged", decision=decision, memory_id=memory_id)
        return {"id": cursor.lastrowid}

    def update_policy_outcome(self, log_id: int, outcome: str) -> None:
        """Update the outcome of a policy decision."""
        self.store.conn.execute("UPDATE policy_log SET outcome = ? WHERE id = ?", (outcome, log_id))
        self.store.conn.commit()

    def shutdown(self) -> None:
        """Clean up resources."""
        self.store.close()
        logger.info("Memory service shut down")
