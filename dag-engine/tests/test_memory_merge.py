"""Tests for merge validation and commit."""
from pathlib import Path

import pytest

from beadsmith_dag.memory.models import MemoryRecord, MemoryTier, MemoryType
from beadsmith_dag.memory.service import MemoryService


@pytest.fixture
def service(tmp_path: Path) -> MemoryService:
    svc = MemoryService(str(tmp_path / "test.db"))
    svc.initialize()
    return svc


class TestValidateMerge:
    def test_validate_returns_valid_flag(self, service: MemoryService) -> None:
        m1 = MemoryRecord(
            content="Use biome",
            type=MemoryType.PATTERN,
            keywords=["biome"],
        )
        m2 = MemoryRecord(
            content="Biome is better than eslint",
            type=MemoryType.PATTERN,
            keywords=["biome", "eslint"],
        )
        service.store.save(m1)
        service.store.save(m2)
        result = service.validate_merge("Use biome instead of eslint", [m1.id, m2.id])
        assert "valid" in result
        assert isinstance(result["valid"], bool)
        assert "score" in result


class TestCommitMerge:
    def test_commit_archives_sources(self, service: MemoryService) -> None:
        m1 = MemoryRecord(
            content="Use biome",
            type=MemoryType.PATTERN,
            keywords=["biome"],
        )
        m2 = MemoryRecord(
            content="Biome > eslint",
            type=MemoryType.PATTERN,
            keywords=["biome", "eslint"],
        )
        service.store.save(m1)
        service.store.save(m2)
        merged = service.commit_merge(
            "Use biome not eslint", [m1.id, m2.id], ["biome", "eslint"], "pattern"
        )
        assert service.store.get(m1.id).tier == MemoryTier.ARCHIVED
        assert service.store.get(m2.id).tier == MemoryTier.ARCHIVED
        assert merged["generation"] == 1

    def test_commit_increments_generation(self, service: MemoryService) -> None:
        m1 = MemoryRecord(
            content="gen1",
            type=MemoryType.PATTERN,
            keywords=["test"],
            generation=1,
        )
        m2 = MemoryRecord(
            content="gen2",
            type=MemoryType.PATTERN,
            keywords=["test"],
            generation=2,
        )
        service.store.save(m1)
        service.store.save(m2)
        merged = service.commit_merge("merged", [m1.id, m2.id], ["test"], "pattern")
        assert merged["generation"] == 3

    def test_commit_creates_evolved_from(self, service: MemoryService) -> None:
        m1 = MemoryRecord(
            content="a", type=MemoryType.FACT, keywords=["x"]
        )
        m2 = MemoryRecord(
            content="b", type=MemoryType.FACT, keywords=["x"]
        )
        service.store.save(m1)
        service.store.save(m2)
        merged = service.commit_merge("a+b", [m1.id, m2.id], ["x"], "fact")
        assert m1.id in merged["evolved_from"]
        assert m2.id in merged["evolved_from"]

    def test_commit_creates_graph_edges(self, service: MemoryService) -> None:
        m1 = MemoryRecord(
            content="a", type=MemoryType.FACT, keywords=["x"]
        )
        m2 = MemoryRecord(
            content="b", type=MemoryType.FACT, keywords=["x"]
        )
        service.store.save(m1)
        service.store.save(m2)
        merged = service.commit_merge("a+b", [m1.id, m2.id], ["x"], "fact")
        related = service.graph.get_related(merged["id"])
        assert m1.id in related
        assert m2.id in related
