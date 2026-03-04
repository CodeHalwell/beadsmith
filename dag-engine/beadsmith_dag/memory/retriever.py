"""Three-layer memory retriever with decay scoring."""

import math
from datetime import datetime, timezone

import structlog

from .embedder import Embedder
from .models import MemoryRecord, MemoryType, RecallResponse, RecallResult
from .store import MemoryStore

logger = structlog.get_logger()


class MemoryRetriever:
    """Retrieve memories using keyword, semantic, and graph search."""

    def __init__(self, store: MemoryStore, embedder: Embedder) -> None:
        self.store = store
        self.embedder = embedder

    def recall(
        self,
        query: str,
        top_k: int = 5,
        memory_type: MemoryType | None = None,
    ) -> RecallResponse:
        """Search memory using all available layers."""
        candidates: dict[str, RecallResult] = {}

        # Layer 1: Keyword search (FTS5)
        keyword_results = self.store.search_keyword(query, limit=top_k * 2)
        for rank, record in enumerate(keyword_results):
            if memory_type and record.type != memory_type:
                continue
            decay = self.compute_decay_score(record)
            rrf_score = 1.0 / (60 + rank)  # RRF with k=60
            candidates[record.id] = RecallResult(
                memory=record,
                score=rrf_score * decay,
                source="keyword",
            )

        # Layer 2: Semantic search (sqlite-vec) — if embeddings available
        if self.embedder.available:
            query_vec = self.embedder.embed(query)
            if query_vec:
                semantic_results = self._search_semantic(query_vec, limit=top_k * 2)
                for rank, (record, sim) in enumerate(semantic_results):
                    if memory_type and record.type != memory_type:
                        continue
                    decay = self.compute_decay_score(record)
                    rrf_score = 1.0 / (60 + rank)
                    combined = rrf_score * decay * (0.5 + 0.5 * sim)  # Boost by similarity
                    if record.id in candidates:
                        # Merge: take the higher score
                        existing = candidates[record.id]
                        if combined > existing.score:
                            candidates[record.id] = RecallResult(
                                memory=record, score=combined, source="semantic"
                            )
                        else:
                            # Boost existing by presence in both layers
                            candidates[record.id] = RecallResult(
                                memory=existing.memory,
                                score=existing.score * 1.2,
                                source=existing.source,
                            )
                    else:
                        candidates[record.id] = RecallResult(
                            memory=record, score=combined, source="semantic"
                        )

        # Sort by score, take top_k
        sorted_results = sorted(candidates.values(), key=lambda r: r.score, reverse=True)
        top_results = sorted_results[:top_k]

        # Record access for retrieved memories
        for result in top_results:
            self.store.record_access(result.memory.id)

        return RecallResponse(
            results=top_results,
            query=query,
            total_searched=len(candidates),
        )

    def compute_decay_score(self, record: MemoryRecord) -> float:
        """Compute time-based decay score for a memory."""
        now = datetime.now(timezone.utc)
        created = datetime.fromisoformat(record.created_at)
        age_days = (now - created).total_seconds() / 86400

        # Recency boost: accessed in last 7 days
        recency_boost = 0.0
        if record.last_accessed_at:
            last_access = datetime.fromisoformat(record.last_accessed_at)
            if (now - last_access).days < 7:
                recency_boost = 1.0

        # Frequency boost: capped at 10 accesses
        frequency_boost = min(record.access_count / 10, 1.0)

        # Exponential decay
        base_decay = math.exp(-0.01 * age_days)

        # Generation floor: compacted memories decay slower
        floor = 0.1 + (0.1 * min(record.generation, 3))

        return max(base_decay + recency_boost * 0.2 + frequency_boost * 0.1, floor)

    def save_embedding(self, memory_id: str, embedding: list[float]) -> None:
        """Save a vector embedding for a memory to sqlite-vec."""
        self.store.save_embedding(memory_id, embedding)

    def _search_semantic(
        self, query_vec: list[float], limit: int = 10
    ) -> list[tuple[MemoryRecord, float]]:
        """Search by vector similarity using sqlite-vec."""
        if not self.store.vec_available:
            return []
        rows = self.store.search_vec(query_vec, limit=limit)
        results: list[tuple[MemoryRecord, float]] = []
        for memory_id, distance in rows:
            record = self.store.get(memory_id)
            if record:
                similarity = 1.0 / (1.0 + distance)
                results.append((record, similarity))
        return results
