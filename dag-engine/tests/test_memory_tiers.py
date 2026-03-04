"""Tests for tier promotion."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from beadsmith_dag.memory.models import MemoryRecord, MemoryTier, MemoryType
from beadsmith_dag.memory.service import MemoryService


@pytest.fixture
def service(tmp_path: Path) -> MemoryService:
    svc = MemoryService(str(tmp_path / "test.db"))
    svc.initialize()
    return svc


class TestTierPromotion:
    def test_hot_to_warm(self, service: MemoryService) -> None:
        old_time = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        record = MemoryRecord(
            content="old hot",
            type=MemoryType.PATTERN,
            tier=MemoryTier.HOT,
            access_count=1,
            created_at=old_time,
            updated_at=old_time,
        )
        service.store.save(record)
        result = service.promote_tiers()
        assert result["promoted"] >= 1
        assert service.store.get(record.id).tier == MemoryTier.WARM

    def test_hot_stays_if_accessed(self, service: MemoryService) -> None:
        old_time = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        record = MemoryRecord(
            content="accessed",
            type=MemoryType.PATTERN,
            tier=MemoryTier.HOT,
            access_count=5,
            created_at=old_time,
            updated_at=old_time,
        )
        service.store.save(record)
        service.promote_tiers()
        assert service.store.get(record.id).tier == MemoryTier.HOT

    def test_warm_to_cold(self, service: MemoryService) -> None:
        old_time = (datetime.now(timezone.utc) - timedelta(days=35)).isoformat()
        record = MemoryRecord(
            content="old warm",
            type=MemoryType.FACT,
            tier=MemoryTier.WARM,
            access_count=0,
            created_at=old_time,
            updated_at=old_time,
        )
        service.store.save(record)
        service.promote_tiers()
        assert service.store.get(record.id).tier == MemoryTier.COLD

    def test_cold_to_archived(self, service: MemoryService) -> None:
        old_time = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
        record = MemoryRecord(
            content="old cold",
            type=MemoryType.FACT,
            tier=MemoryTier.COLD,
            confidence=0.1,
            access_count=0,
            created_at=old_time,
            updated_at=old_time,
        )
        service.store.save(record)
        service.promote_tiers()
        assert service.store.get(record.id).tier == MemoryTier.ARCHIVED

    def test_cold_stays_if_confident(self, service: MemoryService) -> None:
        old_time = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
        record = MemoryRecord(
            content="confident cold",
            type=MemoryType.PATTERN,
            tier=MemoryTier.COLD,
            confidence=0.5,
            access_count=0,
            created_at=old_time,
            updated_at=old_time,
        )
        service.store.save(record)
        service.promote_tiers()
        assert service.store.get(record.id).tier == MemoryTier.COLD
