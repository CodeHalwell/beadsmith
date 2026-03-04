"""Tests for active decay scoring."""
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


class TestApplyDecay:
    def test_apply_decay_updates_confidence(self, service: MemoryService) -> None:
        old_time = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        record = MemoryRecord(
            content="old pattern",
            type=MemoryType.PATTERN,
            created_at=old_time,
            updated_at=old_time,
        )
        service.store.save(record)
        result = service.apply_decay()
        assert result["updated"] >= 1
        updated = service.store.get(record.id)
        assert updated is not None
        assert updated.confidence < 1.0

    def test_apply_decay_skips_archived(self, service: MemoryService) -> None:
        old_time = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        record = MemoryRecord(
            content="archived",
            type=MemoryType.FACT,
            tier=MemoryTier.ARCHIVED,
            created_at=old_time,
            updated_at=old_time,
        )
        service.store.save(record)
        result = service.apply_decay()
        assert result["updated"] == 0

    def test_apply_decay_no_change_for_fresh(self, service: MemoryService) -> None:
        record = MemoryRecord(content="fresh", type=MemoryType.FACT)
        service.store.save(record)
        result = service.apply_decay()
        assert result["updated"] == 0
