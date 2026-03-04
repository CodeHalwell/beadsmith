"""Tests for sqlite-vec integration in MemoryStore."""

import struct
from pathlib import Path

import pytest

from beadsmith_dag.memory.store import MemoryStore


def _serialize_float32(vec: list[float]) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    db_path = tmp_path / "test_vec.db"
    s = MemoryStore(str(db_path))
    s.initialize()
    return s


class TestVecAvailability:
    def test_vec_available_is_bool(self, store: MemoryStore) -> None:
        assert isinstance(store.vec_available, bool)


class TestVecOperations:
    def test_save_and_search_embedding(self, store: MemoryStore) -> None:
        if not store.vec_available:
            pytest.skip("sqlite-vec not available")
        vec = [0.1] * 384
        store.save_embedding("mem_001", vec)
        results = store.search_vec(vec, limit=5)
        assert len(results) >= 1
        assert results[0][0] == "mem_001"

    def test_search_vec_ordering(self, store: MemoryStore) -> None:
        if not store.vec_available:
            pytest.skip("sqlite-vec not available")
        close_vec = [0.5] * 384
        far_vec = [-0.5] * 384
        store.save_embedding("close", close_vec)
        store.save_embedding("far", far_vec)
        query = [0.5] * 384
        results = store.search_vec(query, limit=5)
        assert results[0][0] == "close"

    def test_delete_embedding(self, store: MemoryStore) -> None:
        if not store.vec_available:
            pytest.skip("sqlite-vec not available")
        vec = [0.1] * 384
        store.save_embedding("to_delete", vec)
        store.delete_embedding("to_delete")
        results = store.search_vec(vec, limit=5)
        memory_ids = [r[0] for r in results]
        assert "to_delete" not in memory_ids

    def test_save_embedding_noop_without_vec(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "no_vec.db"))
        store.initialize()
        store.vec_available = False
        store.save_embedding("test", [0.1] * 384)

    def test_search_vec_empty_without_vec(self, tmp_path: Path) -> None:
        store = MemoryStore(str(tmp_path / "no_vec.db"))
        store.initialize()
        store.vec_available = False
        results = store.search_vec([0.1] * 384, limit=5)
        assert results == []
