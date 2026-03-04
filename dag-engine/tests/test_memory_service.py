"""Tests for memory JSON-RPC service integration."""

from pathlib import Path

import pytest

from beadsmith_dag.memory.models import MemoryType
from beadsmith_dag.memory.service import MemoryService


@pytest.fixture
def service(tmp_path: Path) -> MemoryService:
    db_path = str(tmp_path / "test.db")
    svc = MemoryService(db_path)
    svc.initialize()
    return svc


class TestMemoryService:
    def test_save_and_recall(self, service: MemoryService) -> None:
        result = service.save(
            content="VSIX fails with SVG in README",
            memory_type="error_fix",
            keywords=["vsix", "svg"],
            source_task="task_001",
        )
        assert "id" in result
        recall = service.recall(query="VSIX SVG error", top_k=5)
        assert len(recall["results"]) >= 1

    def test_get_stats(self, service: MemoryService) -> None:
        service.save(content="test", memory_type="fact", keywords=[])
        stats = service.get_stats()
        assert stats["total_count"] == 1

    def test_delete(self, service: MemoryService) -> None:
        result = service.save(content="temp", memory_type="fact", keywords=[])
        service.delete(result["id"])
        stats = service.get_stats()
        assert stats["total_count"] == 0

    def test_get_file_memories(self, service: MemoryService) -> None:
        service.save(
            content="state-keys needs state-helpers",
            memory_type="file_relationship",
            keywords=["state"],
            source_file="src/state-keys.ts",
        )
        memories = service.get_file_memories("src/state-keys.ts")
        assert len(memories) >= 1

    def test_record_co_change(self, service: MemoryService) -> None:
        service.record_co_change(["a.ts", "b.ts", "c.ts"])
        # 3 files -> 3 pairs: (a,b), (a,c), (b,c)
        co = service.get_co_changes("a.ts")
        assert len(co) == 2
