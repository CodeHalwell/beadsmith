"""Tests for SQLite memory store."""

from pathlib import Path

import pytest

from beadsmith_dag.memory.models import MemoryRecord, MemoryType, MemoryTier
from beadsmith_dag.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    db_path = tmp_path / "test_memory.db"
    s = MemoryStore(str(db_path))
    s.initialize()
    return s


@pytest.fixture
def sample_memory() -> MemoryRecord:
    return MemoryRecord(
        content="This project uses biome for linting, not eslint",
        type=MemoryType.PATTERN,
        keywords=["biome", "linting", "eslint"],
        source_task="task_001",
    )


class TestMemoryStoreCRUD:
    def test_save_and_get(self, store: MemoryStore, sample_memory: MemoryRecord) -> None:
        store.save(sample_memory)
        retrieved = store.get(sample_memory.id)
        assert retrieved is not None
        assert retrieved.content == sample_memory.content
        assert retrieved.type == MemoryType.PATTERN

    def test_get_nonexistent_returns_none(self, store: MemoryStore) -> None:
        assert store.get("nonexistent_id") is None

    def test_update_confidence(self, store: MemoryStore, sample_memory: MemoryRecord) -> None:
        store.save(sample_memory)
        store.update(sample_memory.id, confidence=0.5)
        retrieved = store.get(sample_memory.id)
        assert retrieved is not None
        assert retrieved.confidence == 0.5

    def test_update_tier(self, store: MemoryStore, sample_memory: MemoryRecord) -> None:
        store.save(sample_memory)
        store.update(sample_memory.id, tier=MemoryTier.WARM)
        retrieved = store.get(sample_memory.id)
        assert retrieved is not None
        assert retrieved.tier == MemoryTier.WARM

    def test_delete(self, store: MemoryStore, sample_memory: MemoryRecord) -> None:
        store.save(sample_memory)
        store.delete(sample_memory.id)
        assert store.get(sample_memory.id) is None

    def test_list_all(self, store: MemoryStore) -> None:
        for i in range(3):
            store.save(MemoryRecord(
                content=f"Memory {i}",
                type=MemoryType.FACT,
            ))
        results = store.list_all()
        assert len(results) == 3

    def test_list_by_tier(self, store: MemoryStore) -> None:
        store.save(MemoryRecord(content="hot", type=MemoryType.FACT, tier=MemoryTier.HOT))
        store.save(MemoryRecord(content="warm", type=MemoryType.FACT, tier=MemoryTier.WARM))
        hot = store.list_all(tier=MemoryTier.HOT)
        assert len(hot) == 1
        assert hot[0].content == "hot"

    def test_increment_access(self, store: MemoryStore, sample_memory: MemoryRecord) -> None:
        store.save(sample_memory)
        store.record_access(sample_memory.id)
        retrieved = store.get(sample_memory.id)
        assert retrieved is not None
        assert retrieved.access_count == 1
        assert retrieved.last_accessed_at is not None


class TestMemoryStoreFTS:
    def test_keyword_search(self, store: MemoryStore) -> None:
        store.save(MemoryRecord(
            content="VSIX packaging fails with SVG images in README",
            type=MemoryType.ERROR_FIX,
            keywords=["vsix", "svg", "readme"],
        ))
        store.save(MemoryRecord(
            content="Always run npm run protos after changing proto files",
            type=MemoryType.PATTERN,
            keywords=["protos", "protobuf"],
        ))
        results = store.search_keyword("VSIX SVG")
        assert len(results) >= 1
        assert "VSIX" in results[0].content

    def test_keyword_search_no_results(self, store: MemoryStore) -> None:
        store.save(MemoryRecord(content="test memory", type=MemoryType.FACT))
        results = store.search_keyword("nonexistent query xyz")
        assert len(results) == 0

    def test_keyword_search_limit(self, store: MemoryStore) -> None:
        for i in range(20):
            store.save(MemoryRecord(
                content=f"Pattern number {i} for testing search",
                type=MemoryType.PATTERN,
                keywords=["testing", "search"],
            ))
        results = store.search_keyword("testing search", limit=5)
        assert len(results) <= 5


class TestMemoryStoreStats:
    def test_get_stats(self, store: MemoryStore) -> None:
        store.save(MemoryRecord(content="hot", type=MemoryType.FACT, tier=MemoryTier.HOT))
        store.save(MemoryRecord(content="warm", type=MemoryType.FACT, tier=MemoryTier.WARM))
        stats = store.get_stats()
        assert stats.total_count == 2
        assert stats.hot_count == 1
        assert stats.warm_count == 1
