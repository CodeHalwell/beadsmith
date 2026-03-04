"""Tests for retriever sqlite-vec semantic search integration."""

from pathlib import Path

import pytest

from beadsmith_dag.memory.embedder import Embedder
from beadsmith_dag.memory.models import MemoryRecord, MemoryType
from beadsmith_dag.memory.retriever import MemoryRetriever
from beadsmith_dag.memory.store import MemoryStore


@pytest.fixture
def retriever(tmp_path: Path) -> MemoryRetriever:
    store = MemoryStore(str(tmp_path / "test.db"))
    store.initialize()
    embedder = Embedder()
    return MemoryRetriever(store=store, embedder=embedder)


class TestRetrieverVecIntegration:
    def test_save_embedding_persists(self, retriever: MemoryRetriever) -> None:
        if not retriever.store.vec_available or not retriever.embedder.available:
            pytest.skip("sqlite-vec or sentence-transformers not available")
        record = MemoryRecord(content="test embedding", type=MemoryType.FACT)
        retriever.store.save(record)
        vec = retriever.embedder.embed(record.content)
        retriever.save_embedding(record.id, vec)
        results = retriever.store.search_vec(vec, limit=1)
        assert len(results) == 1
        assert results[0][0] == record.id

    def test_semantic_search_returns_results(self, retriever: MemoryRetriever) -> None:
        if not retriever.store.vec_available or not retriever.embedder.available:
            pytest.skip("sqlite-vec or sentence-transformers not available")
        record = MemoryRecord(
            content="VSIX packaging fails with SVG images",
            type=MemoryType.ERROR_FIX,
            keywords=["vsix", "svg"],
        )
        retriever.store.save(record)
        vec = retriever.embedder.embed(record.content)
        retriever.save_embedding(record.id, vec)
        query_vec = retriever.embedder.embed("VSIX build error with SVG")
        results = retriever._search_semantic(query_vec, limit=5)
        assert len(results) >= 1
        assert results[0][0].id == record.id
        assert results[0][1] > 0

    def test_recall_uses_semantic_layer(self, retriever: MemoryRetriever) -> None:
        if not retriever.store.vec_available or not retriever.embedder.available:
            pytest.skip("sqlite-vec or sentence-transformers not available")
        record = MemoryRecord(
            content="Build artifacts fail when README contains vector graphics",
            type=MemoryType.ERROR_FIX,
            keywords=["build", "readme"],
        )
        retriever.store.save(record)
        vec = retriever.embedder.embed(record.content)
        retriever.save_embedding(record.id, vec)
        response = retriever.recall("VSIX packaging SVG error", top_k=5)
        found_ids = [r.memory.id for r in response.results]
        assert record.id in found_ids
