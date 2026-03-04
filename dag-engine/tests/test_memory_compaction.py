"""Tests for merge candidates."""
from pathlib import Path

import pytest

from beadsmith_dag.memory.models import MemoryRecord, MemoryTier, MemoryType
from beadsmith_dag.memory.service import MemoryService


@pytest.fixture
def service(tmp_path: Path) -> MemoryService:
    svc = MemoryService(str(tmp_path / "test.db"))
    svc.initialize()
    return svc


class TestGetMergeCandidates:
    def test_groups_by_keyword_overlap(self, service: MemoryService) -> None:
        service.store.save(
            MemoryRecord(
                content="Use biome",
                type=MemoryType.PATTERN,
                keywords=["biome", "linting", "formatting"],
            )
        )
        service.store.save(
            MemoryRecord(
                content="Biome > eslint",
                type=MemoryType.PATTERN,
                keywords=["biome", "eslint", "formatting"],
            )
        )
        result = service.get_merge_candidates(min_jaccard=0.4)
        assert len(result["groups"]) >= 1
        assert len(result["groups"][0]["source_ids"]) == 2

    def test_no_merge_different_types(self, service: MemoryService) -> None:
        service.store.save(
            MemoryRecord(
                content="a",
                type=MemoryType.PATTERN,
                keywords=["biome", "linting"],
            )
        )
        service.store.save(
            MemoryRecord(
                content="b",
                type=MemoryType.PREFERENCE,
                keywords=["biome", "linting"],
            )
        )
        result = service.get_merge_candidates(min_jaccard=0.4)
        assert len(result["groups"]) == 0

    def test_no_merge_generation_gap(self, service: MemoryService) -> None:
        service.store.save(
            MemoryRecord(
                content="gen0",
                type=MemoryType.PATTERN,
                keywords=["biome", "linting"],
                generation=0,
            )
        )
        service.store.save(
            MemoryRecord(
                content="gen3",
                type=MemoryType.PATTERN,
                keywords=["biome", "linting"],
                generation=3,
            )
        )
        result = service.get_merge_candidates(min_jaccard=0.4)
        assert len(result["groups"]) == 0

    def test_only_hot_and_warm(self, service: MemoryService) -> None:
        service.store.save(
            MemoryRecord(
                content="cold",
                type=MemoryType.PATTERN,
                keywords=["biome", "linting"],
                tier=MemoryTier.COLD,
            )
        )
        service.store.save(
            MemoryRecord(
                content="archived",
                type=MemoryType.PATTERN,
                keywords=["biome", "linting"],
                tier=MemoryTier.ARCHIVED,
            )
        )
        result = service.get_merge_candidates(min_jaccard=0.4)
        assert len(result["groups"]) == 0

    def test_empty_with_no_candidates(self, service: MemoryService) -> None:
        result = service.get_merge_candidates()
        assert result["groups"] == []
