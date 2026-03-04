"""Tests for the three-layer memory retriever."""

from pathlib import Path

import pytest

from beadsmith_dag.memory.models import MemoryRecord, MemoryType
from beadsmith_dag.memory.retriever import MemoryRetriever
from beadsmith_dag.memory.store import MemoryStore
from beadsmith_dag.memory.embedder import Embedder


@pytest.fixture
def retriever(tmp_path: Path) -> MemoryRetriever:
    db_path = str(tmp_path / "test.db")
    store = MemoryStore(db_path)
    store.initialize()
    embedder = Embedder()
    r = MemoryRetriever(store=store, embedder=embedder)
    return r


@pytest.fixture
def populated_retriever(retriever: MemoryRetriever) -> MemoryRetriever:
    memories = [
        MemoryRecord(
            content="VSIX packaging fails with SVG images in README. Use PNG instead.",
            type=MemoryType.ERROR_FIX,
            keywords=["vsix", "svg", "png", "readme", "vsce"],
        ),
        MemoryRecord(
            content="This project uses biome for linting and formatting, not eslint.",
            type=MemoryType.PATTERN,
            keywords=["biome", "linting", "formatting", "eslint"],
        ),
        MemoryRecord(
            content="Always run npm run protos after modifying .proto files.",
            type=MemoryType.PATTERN,
            keywords=["protos", "protobuf", "grpc", "codegen"],
        ),
        MemoryRecord(
            content="The user prefers subagent-driven development for implementation.",
            type=MemoryType.PREFERENCE,
            keywords=["subagent", "workflow", "preference"],
        ),
        MemoryRecord(
            content="Changing state-keys.ts requires updating state-helpers.ts too.",
            type=MemoryType.FILE_RELATIONSHIP,
            keywords=["state-keys", "state-helpers", "global-state"],
            source_file="src/shared/storage/state-keys.ts",
        ),
    ]
    for m in memories:
        retriever.store.save(m)
        if retriever.embedder.available:
            vec = retriever.embedder.embed(m.content)
            if vec:
                retriever.save_embedding(m.id, vec)
    return retriever


class TestRetrieverKeyword:
    def test_keyword_recall(self, populated_retriever: MemoryRetriever) -> None:
        results = populated_retriever.recall("VSIX SVG packaging error", top_k=3)
        assert len(results.results) >= 1
        assert "VSIX" in results.results[0].memory.content

    def test_recall_with_type_filter(self, populated_retriever: MemoryRetriever) -> None:
        results = populated_retriever.recall(
            "linting formatting", top_k=5, memory_type=MemoryType.PATTERN
        )
        for r in results.results:
            assert r.memory.type == MemoryType.PATTERN

    def test_recall_empty_query(self, populated_retriever: MemoryRetriever) -> None:
        results = populated_retriever.recall("xyznonexistent123")
        assert len(results.results) == 0


class TestRetrieverDecay:
    def test_decay_score_fresh_memory(self, retriever: MemoryRetriever) -> None:
        record = MemoryRecord(content="fresh", type=MemoryType.FACT)
        score = retriever.compute_decay_score(record)
        assert score > 0.9  # Fresh memory, no decay

    def test_decay_score_respects_access(self, retriever: MemoryRetriever) -> None:
        record_accessed = MemoryRecord(
            content="accessed", type=MemoryType.FACT, access_count=10
        )
        record_not_accessed = MemoryRecord(
            content="not accessed", type=MemoryType.FACT, access_count=0
        )
        score_a = retriever.compute_decay_score(record_accessed)
        score_b = retriever.compute_decay_score(record_not_accessed)
        assert score_a > score_b
