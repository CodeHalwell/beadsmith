"""Tests for memory graph extension."""

from pathlib import Path

import pytest

from beadsmith_dag.memory.graph_ext import MemoryGraph
from beadsmith_dag.memory.store import MemoryStore


@pytest.fixture
def graph(tmp_path: Path) -> MemoryGraph:
    store = MemoryStore(str(tmp_path / "test.db"))
    store.initialize()
    g = MemoryGraph(store)
    return g


class TestMemoryGraph:
    def test_add_edge(self, graph: MemoryGraph) -> None:
        graph.add_edge("mem_1", "mem_2", "related")
        neighbors = graph.get_related("mem_1")
        assert "mem_2" in neighbors

    def test_add_co_changed_edge(self, graph: MemoryGraph) -> None:
        graph.record_co_change("file_a.py", "file_b.py")
        graph.record_co_change("file_a.py", "file_b.py")
        edges = graph.get_co_changes("file_a.py")
        assert len(edges) == 1
        assert edges[0][0] == "file_b.py"
        assert edges[0][1] == 2.0  # weight incremented

    def test_get_related_with_depth(self, graph: MemoryGraph) -> None:
        graph.add_edge("a", "b", "related")
        graph.add_edge("b", "c", "related")
        graph.add_edge("c", "d", "related")
        depth1 = graph.get_related("a", max_depth=1)
        depth2 = graph.get_related("a", max_depth=2)
        assert "b" in depth1
        assert "c" not in depth1
        assert "c" in depth2

    def test_persist_and_reload(self, graph: MemoryGraph) -> None:
        graph.add_edge("x", "y", "evolved_from")
        # Create a new graph from the same store
        graph2 = MemoryGraph(graph.store)
        graph2.load_from_store()
        neighbors = graph2.get_related("x")
        assert "y" in neighbors
