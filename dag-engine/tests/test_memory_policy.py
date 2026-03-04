"""Tests for policy logging."""
from pathlib import Path

import pytest

from beadsmith_dag.memory.service import MemoryService


@pytest.fixture
def service(tmp_path: Path) -> MemoryService:
    svc = MemoryService(str(tmp_path / "test.db"))
    svc.initialize()
    return svc


class TestPolicyLogging:
    def test_log_policy_returns_id(self, service: MemoryService) -> None:
        result = service.log_policy(
            decision="save", memory_id="mem_001", context="Task completed"
        )
        assert "id" in result
        assert isinstance(result["id"], int)

    def test_log_policy_without_memory_id(self, service: MemoryService) -> None:
        result = service.log_policy(decision="skip", context="No learnings")
        assert "id" in result

    def test_update_policy_outcome(self, service: MemoryService) -> None:
        entry = service.log_policy(decision="save", memory_id="mem_001")
        service.update_policy_outcome(entry["id"], "useful")
        row = service.store.conn.execute(
            "SELECT outcome FROM policy_log WHERE id = ?", (entry["id"],)
        ).fetchone()
        assert row["outcome"] == "useful"

    def test_log_all_decisions(self, service: MemoryService) -> None:
        for decision in ("save", "skip", "retrieve", "compact"):
            result = service.log_policy(decision=decision)
            assert "id" in result
