"""Tests for memory data models."""

from beadsmith_dag.memory.models import (
    MemoryRecord,
    MemoryEdge,
    MemoryType,
    MemoryTier,
    PolicyLogEntry,
    PolicyDecision,
)


class TestMemoryRecord:
    def test_create_minimal(self) -> None:
        record = MemoryRecord(
            content="This project uses biome for linting",
            type=MemoryType.PATTERN,
        )
        assert record.content == "This project uses biome for linting"
        assert record.type == MemoryType.PATTERN
        assert record.generation == 0
        assert record.tier == MemoryTier.HOT
        assert record.confidence == 1.0
        assert record.access_count == 0
        assert record.id  # ULID auto-generated

    def test_create_full(self) -> None:
        record = MemoryRecord(
            content="VSIX fails with SVG in README",
            type=MemoryType.ERROR_FIX,
            keywords=["vsix", "svg", "readme", "vsce"],
            source_task="task_123",
            source_file="README.md",
        )
        assert record.keywords == ["vsix", "svg", "readme", "vsce"]
        assert record.source_task == "task_123"
        assert record.source_file == "README.md"

    def test_id_is_ulid_format(self) -> None:
        record = MemoryRecord(content="test", type=MemoryType.FACT)
        # ULID: 26 chars, uppercase alphanumeric
        assert len(record.id) == 26

    def test_timestamps_auto_set(self) -> None:
        record = MemoryRecord(content="test", type=MemoryType.FACT)
        assert record.created_at is not None
        assert record.updated_at is not None


class TestMemoryEdge:
    def test_create_edge(self) -> None:
        edge = MemoryEdge(
            from_id="01HXYZ",
            to_id="01HABC",
            edge_type="related",
        )
        assert edge.weight == 1.0

    def test_edge_types(self) -> None:
        for etype in ["related", "evolved_from", "co_changed", "caused_by",
                       "file_memory", "pattern_applies"]:
            edge = MemoryEdge(from_id="a", to_id="b", edge_type=etype)
            assert edge.edge_type == etype


class TestPolicyLogEntry:
    def test_create_save_decision(self) -> None:
        entry = PolicyLogEntry(
            decision=PolicyDecision.SAVE,
            memory_id="01HXYZ",
            context="Task completed with error fix",
        )
        assert entry.outcome == "pending"
