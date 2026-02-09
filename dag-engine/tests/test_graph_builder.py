"""Tests for the GraphBuilder."""

import networkx as nx
import pytest

from beadsmith_dag.graph.builder import GraphBuilder
from beadsmith_dag.models import (
    EdgeConfidence,
    EdgeType,
    GraphEdge,
    GraphNode,
    NodeType,
)


class TestGraphBuilder:
    """Test suite for GraphBuilder."""

    def test_build_writes_all_node_attributes(self) -> None:
        """Test that build() writes all expected node attributes."""
        builder = GraphBuilder()

        nodes = [
            GraphNode(
                id="file:test.py",
                type=NodeType.FILE,
                file_path="test.py",
                line_number=0,
                name="test.py",
                docstring="Test file",
            ),
            GraphNode(
                id="function:test.py:greet",
                type=NodeType.FUNCTION,
                file_path="test.py",
                line_number=5,
                name="greet",
                docstring="Greet the user",
                parameters=["name"],
                return_type="str",
            ),
        ]
        edges = []

        graph = builder.build(nodes, edges)

        # Verify nodes were added
        assert len(graph.nodes) == 2
        assert "file:test.py" in graph.nodes
        assert "function:test.py:greet" in graph.nodes

        # Verify all attributes are present on file node
        file_attrs = graph.nodes["file:test.py"]
        assert file_attrs["type"] == NodeType.FILE.value
        assert file_attrs["file_path"] == "test.py"
        assert file_attrs["line_number"] == 0
        assert file_attrs["name"] == "test.py"
        assert file_attrs["docstring"] == "Test file"
        assert file_attrs["parameters"] == []
        assert file_attrs["return_type"] is None

        # Verify all attributes are present on function node
        func_attrs = graph.nodes["function:test.py:greet"]
        assert func_attrs["type"] == NodeType.FUNCTION.value
        assert func_attrs["file_path"] == "test.py"
        assert func_attrs["line_number"] == 5
        assert func_attrs["name"] == "greet"
        assert func_attrs["docstring"] == "Greet the user"
        assert func_attrs["parameters"] == ["name"]
        assert func_attrs["return_type"] == "str"

    def test_build_writes_all_edge_attributes(self) -> None:
        """Test that build() writes all expected edge attributes."""
        builder = GraphBuilder()

        nodes = [
            GraphNode(
                id="function:test.py:main",
                type=NodeType.FUNCTION,
                file_path="test.py",
                line_number=10,
                name="main",
            ),
            GraphNode(
                id="function:test.py:greet",
                type=NodeType.FUNCTION,
                file_path="test.py",
                line_number=5,
                name="greet",
            ),
        ]

        edges = [
            GraphEdge(
                from_node="function:test.py:main",
                to_node="function:test.py:greet",
                edge_type=EdgeType.CALL,
                confidence=EdgeConfidence.HIGH,
                line_number=12,
                label="calls greet()",
            )
        ]

        graph = builder.build(nodes, edges)

        # Verify edge was added
        assert graph.has_edge("function:test.py:main", "function:test.py:greet")

        # Verify all edge attributes
        edge_attrs = graph.edges["function:test.py:main", "function:test.py:greet"]
        assert edge_attrs["edge_type"] == EdgeType.CALL.value
        assert edge_attrs["confidence"] == EdgeConfidence.HIGH.value
        assert edge_attrs["line_number"] == 12
        assert edge_attrs["label"] == "calls greet()"

    def test_merge_graphs_preserves_attributes(self) -> None:
        """Test that merge_graphs() preserves node and edge attributes."""
        builder = GraphBuilder()

        # Create first graph
        nodes1 = [
            GraphNode(
                id="file:a.py",
                type=NodeType.FILE,
                file_path="a.py",
                line_number=0,
                name="a.py",
                docstring="File A",
            )
        ]
        graph1 = builder.build(nodes1, [])

        # Create second graph
        nodes2 = [
            GraphNode(
                id="file:b.py",
                type=NodeType.FILE,
                file_path="b.py",
                line_number=0,
                name="b.py",
                docstring="File B",
            )
        ]
        graph2 = builder.build(nodes2, [])

        # Merge
        merged = builder.merge_graphs([graph1, graph2])

        # Verify both nodes are present
        assert len(merged.nodes) == 2
        assert "file:a.py" in merged.nodes
        assert "file:b.py" in merged.nodes

        # Verify attributes are preserved
        assert merged.nodes["file:a.py"]["docstring"] == "File A"
        assert merged.nodes["file:b.py"]["docstring"] == "File B"

    def test_merge_graphs_handles_node_collisions(self) -> None:
        """Test that merge_graphs() handles duplicate nodes deterministically."""
        builder = GraphBuilder()

        # Create two graphs with the same node
        nodes = [
            GraphNode(
                id="file:test.py",
                type=NodeType.FILE,
                file_path="test.py",
                line_number=0,
                name="test.py",
                docstring="First version",
            )
        ]
        graph1 = builder.build(nodes, [])

        nodes2 = [
            GraphNode(
                id="file:test.py",
                type=NodeType.FILE,
                file_path="test.py",
                line_number=0,
                name="test.py",
                docstring="Second version",
            )
        ]
        graph2 = builder.build(nodes2, [])

        # Merge
        merged = builder.merge_graphs([graph1, graph2])

        # Should only have one node
        assert len(merged.nodes) == 1
        assert "file:test.py" in merged.nodes
        # First version should be kept (deterministic behavior)
        assert merged.nodes["file:test.py"]["docstring"] == "First version"

    def test_merge_graphs_handles_edge_collisions(self) -> None:
        """Test that merge_graphs() handles duplicate edges deterministically."""
        builder = GraphBuilder()

        # Create nodes
        nodes = [
            GraphNode(
                id="function:test.py:main",
                type=NodeType.FUNCTION,
                file_path="test.py",
                line_number=10,
                name="main",
            ),
            GraphNode(
                id="function:test.py:greet",
                type=NodeType.FUNCTION,
                file_path="test.py",
                line_number=5,
                name="greet",
            ),
        ]

        # Create two graphs with the same edge
        edges1 = [
            GraphEdge(
                from_node="function:test.py:main",
                to_node="function:test.py:greet",
                edge_type=EdgeType.CALL,
                confidence=EdgeConfidence.HIGH,
                line_number=12,
                label="first call",
            )
        ]
        graph1 = builder.build(nodes, edges1)

        edges2 = [
            GraphEdge(
                from_node="function:test.py:main",
                to_node="function:test.py:greet",
                edge_type=EdgeType.CALL,
                confidence=EdgeConfidence.MEDIUM,
                line_number=13,
                label="second call",
            )
        ]
        graph2 = builder.build(nodes, edges2)

        # Merge
        merged = builder.merge_graphs([graph1, graph2])

        # Should only have one edge
        assert len(merged.edges) == 1
        # First version should be kept
        edge_attrs = merged.edges["function:test.py:main", "function:test.py:greet"]
        assert edge_attrs["label"] == "first call"
        assert edge_attrs["confidence"] == EdgeConfidence.HIGH.value

    def test_filter_by_confidence_high(self) -> None:
        """Test filter_by_confidence() correctly includes/excludes edges for high threshold."""
        builder = GraphBuilder()

        nodes = [
            GraphNode(id="node1", type=NodeType.FUNCTION, file_path="test.py", line_number=1, name="node1"),
            GraphNode(id="node2", type=NodeType.FUNCTION, file_path="test.py", line_number=2, name="node2"),
            GraphNode(id="node3", type=NodeType.FUNCTION, file_path="test.py", line_number=3, name="node3"),
            GraphNode(id="node4", type=NodeType.FUNCTION, file_path="test.py", line_number=4, name="node4"),
        ]

        edges = [
            GraphEdge(from_node="node1", to_node="node2", edge_type=EdgeType.CALL, confidence=EdgeConfidence.HIGH, line_number=0, label="test"),
            GraphEdge(from_node="node1", to_node="node3", edge_type=EdgeType.CALL, confidence=EdgeConfidence.MEDIUM, line_number=0, label="test"),
            GraphEdge(from_node="node1", to_node="node4", edge_type=EdgeType.CALL, confidence=EdgeConfidence.LOW, line_number=0, label="test"),
        ]

        graph = builder.build(nodes, edges)
        filtered = builder.filter_by_confidence(graph, "high")

        # All nodes should be present
        assert len(filtered.nodes) == 4

        # Only high confidence edge should remain
        assert len(filtered.edges) == 1
        assert filtered.has_edge("node1", "node2")
        assert not filtered.has_edge("node1", "node3")
        assert not filtered.has_edge("node1", "node4")

    def test_filter_by_confidence_medium(self) -> None:
        """Test filter_by_confidence() correctly includes edges at or above medium threshold."""
        builder = GraphBuilder()

        nodes = [
            GraphNode(id="node1", type=NodeType.FUNCTION, file_path="test.py", line_number=1, name="node1"),
            GraphNode(id="node2", type=NodeType.FUNCTION, file_path="test.py", line_number=2, name="node2"),
            GraphNode(id="node3", type=NodeType.FUNCTION, file_path="test.py", line_number=3, name="node3"),
            GraphNode(id="node4", type=NodeType.FUNCTION, file_path="test.py", line_number=4, name="node4"),
        ]

        edges = [
            GraphEdge(from_node="node1", to_node="node2", edge_type=EdgeType.CALL, confidence=EdgeConfidence.HIGH, line_number=0, label="test"),
            GraphEdge(from_node="node1", to_node="node3", edge_type=EdgeType.CALL, confidence=EdgeConfidence.MEDIUM, line_number=0, label="test"),
            GraphEdge(from_node="node1", to_node="node4", edge_type=EdgeType.CALL, confidence=EdgeConfidence.LOW, line_number=0, label="test"),
        ]

        graph = builder.build(nodes, edges)
        filtered = builder.filter_by_confidence(graph, "medium")

        # All nodes should be present
        assert len(filtered.nodes) == 4

        # High and medium confidence edges should remain
        assert len(filtered.edges) == 2
        assert filtered.has_edge("node1", "node2")
        assert filtered.has_edge("node1", "node3")
        assert not filtered.has_edge("node1", "node4")

    def test_filter_by_confidence_low(self) -> None:
        """Test filter_by_confidence() includes all non-unsafe edges for low threshold."""
        builder = GraphBuilder()

        nodes = [
            GraphNode(id="node1", type=NodeType.FUNCTION, file_path="test.py", line_number=1, name="node1"),
            GraphNode(id="node2", type=NodeType.FUNCTION, file_path="test.py", line_number=2, name="node2"),
            GraphNode(id="node3", type=NodeType.FUNCTION, file_path="test.py", line_number=3, name="node3"),
            GraphNode(id="node4", type=NodeType.FUNCTION, file_path="test.py", line_number=4, name="node4"),
            GraphNode(id="node5", type=NodeType.FUNCTION, file_path="test.py", line_number=5, name="node5"),
        ]

        edges = [
            GraphEdge(from_node="node1", to_node="node2", edge_type=EdgeType.CALL, confidence=EdgeConfidence.HIGH, line_number=0, label="test"),
            GraphEdge(from_node="node1", to_node="node3", edge_type=EdgeType.CALL, confidence=EdgeConfidence.MEDIUM, line_number=0, label="test"),
            GraphEdge(from_node="node1", to_node="node4", edge_type=EdgeType.CALL, confidence=EdgeConfidence.LOW, line_number=0, label="test"),
            GraphEdge(from_node="node1", to_node="node5", edge_type=EdgeType.CALL, confidence=EdgeConfidence.UNSAFE, line_number=0, label="test"),
        ]

        graph = builder.build(nodes, edges)
        filtered = builder.filter_by_confidence(graph, "low")

        # All nodes should be present
        assert len(filtered.nodes) == 5

        # All edges except unsafe should remain
        assert len(filtered.edges) == 3
        assert filtered.has_edge("node1", "node2")
        assert filtered.has_edge("node1", "node3")
        assert filtered.has_edge("node1", "node4")
        assert not filtered.has_edge("node1", "node5")

    def test_filter_by_confidence_unsafe(self) -> None:
        """Test filter_by_confidence() includes all edges for unsafe threshold."""
        builder = GraphBuilder()

        nodes = [
            GraphNode(id="node1", type=NodeType.FUNCTION, file_path="test.py", line_number=1, name="node1"),
            GraphNode(id="node2", type=NodeType.FUNCTION, file_path="test.py", line_number=2, name="node2"),
            GraphNode(id="node3", type=NodeType.FUNCTION, file_path="test.py", line_number=3, name="node3"),
        ]

        edges = [
            GraphEdge(from_node="node1", to_node="node2", edge_type=EdgeType.CALL, confidence=EdgeConfidence.HIGH, line_number=0, label="test"),
            GraphEdge(from_node="node1", to_node="node3", edge_type=EdgeType.CALL, confidence=EdgeConfidence.UNSAFE, line_number=0, label="test"),
        ]

        graph = builder.build(nodes, edges)
        filtered = builder.filter_by_confidence(graph, "unsafe")

        # All nodes and edges should remain
        assert len(filtered.nodes) == 3
        assert len(filtered.edges) == 2
        assert filtered.has_edge("node1", "node2")
        assert filtered.has_edge("node1", "node3")

    def test_empty_graph(self) -> None:
        """Test building an empty graph."""
        builder = GraphBuilder()
        graph = builder.build([], [])

        assert len(graph.nodes) == 0
        assert len(graph.edges) == 0

    def test_merge_empty_graphs(self) -> None:
        """Test merging empty graphs."""
        builder = GraphBuilder()
        merged = builder.merge_graphs([])

        assert len(merged.nodes) == 0
        assert len(merged.edges) == 0

    def test_filter_empty_graph(self) -> None:
        """Test filtering an empty graph."""
        builder = GraphBuilder()
        empty_graph = nx.DiGraph()
        filtered = builder.filter_by_confidence(empty_graph, "high")

        assert len(filtered.nodes) == 0
        assert len(filtered.edges) == 0
