"""Tests for the DAG impact analysis query engine.

Exercises the full pipeline: parse files -> build graph -> query impact.
"""

from pathlib import Path

import pytest

from beadsmith_dag.graph.builder import GraphBuilder
from beadsmith_dag.graph.queries import GraphQueries
from beadsmith_dag.models import (
    EdgeConfidence,
    EdgeType,
    GraphEdge,
    GraphNode,
    ImpactReport,
    NodeType,
)
from beadsmith_dag.parsers.python_parser import PythonParser


def _resolve_edges(nodes: list[GraphNode], edges: list[GraphEdge]) -> list[GraphEdge]:
    """Resolve bare module names in edge targets to matching file node IDs.

    The parser creates import edges with bare module names (e.g., to_node="module_a")
    but file nodes use full paths (e.g., id="/tmp/.../module_a.py"). This helper maps
    bare names to actual node IDs so the graph connects properly.
    """
    file_stem_to_id: dict[str, str] = {}
    for node in nodes:
        if node.type == NodeType.FILE:
            stem = Path(node.file_path).stem
            file_stem_to_id[stem] = node.id

    resolved: list[GraphEdge] = []
    for edge in edges:
        to_node = edge.to_node
        if to_node in file_stem_to_id:
            to_node = file_stem_to_id[to_node]
        resolved.append(edge.model_copy(update={"to_node": to_node}))
    return resolved


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_linear_chain() -> GraphQueries:
    """Build a simple linear dependency chain: C -> B -> A.

    module_c imports module_b, module_b imports module_a.
    Changing module_a should impact module_b (direct) and module_c (transitive).
    """
    builder = GraphBuilder()

    nodes = [
        GraphNode(id="module_a.py", type=NodeType.FILE, file_path="module_a.py", line_number=1, name="module_a.py"),
        GraphNode(id="module_b.py", type=NodeType.FILE, file_path="module_b.py", line_number=1, name="module_b.py"),
        GraphNode(id="module_c.py", type=NodeType.FILE, file_path="module_c.py", line_number=1, name="module_c.py"),
    ]

    # module_b depends on module_a (edge from B to A)
    # module_c depends on module_b (edge from C to B)
    edges = [
        GraphEdge(
            from_node="module_b.py",
            to_node="module_a.py",
            edge_type=EdgeType.IMPORT,
            confidence=EdgeConfidence.HIGH,
            line_number=1,
            label="import module_a",
        ),
        GraphEdge(
            from_node="module_c.py",
            to_node="module_b.py",
            edge_type=EdgeType.IMPORT,
            confidence=EdgeConfidence.HIGH,
            line_number=1,
            label="import module_b",
        ),
    ]

    graph = builder.build(nodes, edges)
    return GraphQueries(graph)


def _build_function_level_graph() -> GraphQueries:
    """Build a graph with function-level nodes and call edges.

    module_a.py has helper()
    module_b.py has process() which calls module_a:helper
    module_c.py has run() which calls module_b:process
    """
    builder = GraphBuilder()

    nodes = [
        GraphNode(id="module_a.py", type=NodeType.FILE, file_path="module_a.py", line_number=1, name="module_a.py"),
        GraphNode(id="module_a.py:helper", type=NodeType.FUNCTION, file_path="module_a.py", line_number=5, name="helper"),
        GraphNode(id="module_b.py", type=NodeType.FILE, file_path="module_b.py", line_number=1, name="module_b.py"),
        GraphNode(id="module_b.py:process", type=NodeType.FUNCTION, file_path="module_b.py", line_number=5, name="process"),
        GraphNode(id="module_c.py", type=NodeType.FILE, file_path="module_c.py", line_number=1, name="module_c.py"),
        GraphNode(id="module_c.py:run", type=NodeType.FUNCTION, file_path="module_c.py", line_number=5, name="run"),
    ]

    edges = [
        # module_b:process calls module_a:helper
        GraphEdge(
            from_node="module_b.py:process",
            to_node="module_a.py:helper",
            edge_type=EdgeType.CALL,
            confidence=EdgeConfidence.HIGH,
            line_number=6,
            label="calls helper",
        ),
        # module_c:run calls module_b:process
        GraphEdge(
            from_node="module_c.py:run",
            to_node="module_b.py:process",
            edge_type=EdgeType.CALL,
            confidence=EdgeConfidence.HIGH,
            line_number=6,
            label="calls process",
        ),
    ]

    graph = builder.build(nodes, edges)
    return GraphQueries(graph)


def _build_diamond_graph() -> GraphQueries:
    """Build a diamond dependency graph.

         A
        / \\
       B   C
        \\ /
         D

    D depends on B and C; B and C both depend on A.
    Changing A impacts B, C, and D.
    """
    builder = GraphBuilder()

    nodes = [
        GraphNode(id="a.py", type=NodeType.FILE, file_path="a.py", line_number=1, name="a.py"),
        GraphNode(id="b.py", type=NodeType.FILE, file_path="b.py", line_number=1, name="b.py"),
        GraphNode(id="c.py", type=NodeType.FILE, file_path="c.py", line_number=1, name="c.py"),
        GraphNode(id="d.py", type=NodeType.FILE, file_path="d.py", line_number=1, name="d.py"),
    ]

    edges = [
        GraphEdge(from_node="b.py", to_node="a.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.HIGH, line_number=1, label="import a"),
        GraphEdge(from_node="c.py", to_node="a.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.HIGH, line_number=1, label="import a"),
        GraphEdge(from_node="d.py", to_node="b.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.HIGH, line_number=1, label="import b"),
        GraphEdge(from_node="d.py", to_node="c.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.HIGH, line_number=1, label="import c"),
    ]

    graph = builder.build(nodes, edges)
    return GraphQueries(graph)


# ---------------------------------------------------------------------------
# Tests — Direct Impact
# ---------------------------------------------------------------------------

class TestDirectImpact:
    """Changing module_a should impact module_b (direct dependent)."""

    def test_direct_dependent_in_affected_files(self) -> None:
        """module_b directly imports module_a, so it should appear in affected_files."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py")

        assert "module_b.py" in report.affected_files

    def test_direct_dependent_report_type(self) -> None:
        """get_impact should return an ImpactReport instance."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py")

        assert isinstance(report, ImpactReport)

    def test_direct_dependent_changed_file(self) -> None:
        """The changed_file field should be set correctly."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py")

        assert report.changed_file == "module_a.py"

    def test_direct_impact_depth_at_least_one(self) -> None:
        """Impact depth should be at least 1 when there is a direct dependent."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py")

        assert report.impact_depth >= 1

    def test_diamond_direct_dependents(self) -> None:
        """In a diamond graph, changing A should directly impact B and C."""
        queries = _build_diamond_graph()
        report = queries.get_impact("a.py")

        assert "b.py" in report.affected_files
        assert "c.py" in report.affected_files


# ---------------------------------------------------------------------------
# Tests — Transitive Impact
# ---------------------------------------------------------------------------

class TestTransitiveImpact:
    """Changing module_a should transitively impact module_c."""

    def test_transitive_dependent_in_affected_files(self) -> None:
        """module_c transitively depends on module_a via module_b."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py")

        assert "module_c.py" in report.affected_files

    def test_transitive_impact_includes_both_direct_and_indirect(self) -> None:
        """Both direct (module_b) and transitive (module_c) dependents should appear."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py")

        assert "module_b.py" in report.affected_files
        assert "module_c.py" in report.affected_files

    def test_transitive_impact_depth_reaches_chain(self) -> None:
        """Impact depth should reflect the chain length."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py")

        # chain is A <- B <- C, so depth should be at least 2
        assert report.impact_depth >= 2

    def test_diamond_transitive_impact(self) -> None:
        """In a diamond graph, changing A should transitively impact D via B and C."""
        queries = _build_diamond_graph()
        report = queries.get_impact("a.py")

        assert "d.py" in report.affected_files

    def test_max_depth_limits_traversal(self) -> None:
        """Setting max_depth=1 should only find direct dependents, not transitive ones."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py", max_depth=1)

        assert "module_b.py" in report.affected_files
        assert "module_c.py" not in report.affected_files


# ---------------------------------------------------------------------------
# Tests — Function-Level Impact
# ---------------------------------------------------------------------------

class TestFunctionLevelImpact:
    """Changing a specific function should identify affected functions."""

    def test_function_change_impacts_direct_caller(self) -> None:
        """Changing module_a:helper should impact module_b:process (direct caller)."""
        queries = _build_function_level_graph()
        report = queries.get_impact("module_a.py:helper")

        assert "module_b.py:process" in report.affected_functions

    def test_function_change_impacts_transitive_caller(self) -> None:
        """Changing module_a:helper should transitively impact module_c:run."""
        queries = _build_function_level_graph()
        report = queries.get_impact("module_a.py:helper")

        assert "module_c.py:run" in report.affected_functions

    def test_function_change_populates_affected_files(self) -> None:
        """Function-level impact should also list the affected files."""
        queries = _build_function_level_graph()
        report = queries.get_impact("module_a.py:helper")

        assert "module_b.py" in report.affected_files
        assert "module_c.py" in report.affected_files

    def test_function_change_sets_changed_function(self) -> None:
        """The changed_function field should be populated when node_id has a colon."""
        queries = _build_function_level_graph()
        report = queries.get_impact("module_a.py:helper")

        assert report.changed_function == "helper"
        assert report.changed_file == "module_a.py"

    def test_middle_function_change_impacts_only_upstream_callers(self) -> None:
        """Changing module_b:process should impact module_c:run but NOT module_a:helper."""
        queries = _build_function_level_graph()
        report = queries.get_impact("module_b.py:process")

        assert "module_c.py:run" in report.affected_functions
        assert "module_a.py:helper" not in report.affected_functions


# ---------------------------------------------------------------------------
# Tests — No Impact on Unrelated
# ---------------------------------------------------------------------------

class TestNoImpactOnUnrelated:
    """Changing a leaf node should NOT impact its dependencies (upstream modules)."""

    def test_leaf_change_does_not_impact_upstream(self) -> None:
        """Changing module_c should NOT impact module_a or module_b."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_c.py")

        assert "module_a.py" not in report.affected_files
        assert "module_b.py" not in report.affected_files

    def test_leaf_change_has_empty_affected_files(self) -> None:
        """Changing a leaf node should produce an empty affected_files list."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_c.py")

        assert report.affected_files == []

    def test_leaf_change_has_zero_impact_depth(self) -> None:
        """Impact depth for a leaf node should be 0."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_c.py")

        assert report.impact_depth == 0

    def test_middle_node_does_not_impact_dependency(self) -> None:
        """Changing module_b should NOT impact module_a (its dependency)."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_b.py")

        assert "module_a.py" not in report.affected_files
        # But module_c should still be impacted
        assert "module_c.py" in report.affected_files

    def test_nonexistent_node_returns_empty_report(self) -> None:
        """Querying impact for a node not in the graph should return an empty report."""
        queries = _build_linear_chain()
        report = queries.get_impact("does_not_exist.py")

        assert report.affected_files == []
        assert report.affected_functions == []
        assert report.impact_depth == 0

    def test_function_leaf_does_not_impact_callees(self) -> None:
        """Changing module_c:run should NOT impact module_b:process or module_a:helper."""
        queries = _build_function_level_graph()
        report = queries.get_impact("module_c.py:run")

        assert "module_b.py:process" not in report.affected_functions
        assert "module_a.py:helper" not in report.affected_functions


# ---------------------------------------------------------------------------
# Tests — Confidence Filtering
# ---------------------------------------------------------------------------

class TestConfidenceFiltering:
    """Impact analysis should respect min_confidence parameter."""

    def _build_mixed_confidence_graph(self) -> GraphQueries:
        """Build a graph with edges of different confidence levels.

        high_dep -> target (HIGH)
        medium_dep -> target (MEDIUM)
        low_dep -> target (LOW)
        """
        builder = GraphBuilder()

        nodes = [
            GraphNode(id="target.py", type=NodeType.FILE, file_path="target.py", line_number=1, name="target.py"),
            GraphNode(id="high_dep.py", type=NodeType.FILE, file_path="high_dep.py", line_number=1, name="high_dep.py"),
            GraphNode(id="medium_dep.py", type=NodeType.FILE, file_path="medium_dep.py", line_number=1, name="medium_dep.py"),
            GraphNode(id="low_dep.py", type=NodeType.FILE, file_path="low_dep.py", line_number=1, name="low_dep.py"),
        ]

        edges = [
            GraphEdge(from_node="high_dep.py", to_node="target.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.HIGH, line_number=1, label="import target"),
            GraphEdge(from_node="medium_dep.py", to_node="target.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.MEDIUM, line_number=1, label="import target"),
            GraphEdge(from_node="low_dep.py", to_node="target.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.LOW, line_number=1, label="import target"),
        ]

        graph = builder.build(nodes, edges)
        return GraphQueries(graph)

    def test_high_confidence_filter_excludes_lower(self) -> None:
        """With min_confidence='high', only high-confidence dependents should appear."""
        queries = self._build_mixed_confidence_graph()
        report = queries.get_impact("target.py", min_confidence="high")

        assert "high_dep.py" in report.affected_files
        assert "medium_dep.py" not in report.affected_files
        assert "low_dep.py" not in report.affected_files

    def test_medium_confidence_filter(self) -> None:
        """With min_confidence='medium', high and medium dependents should appear."""
        queries = self._build_mixed_confidence_graph()
        report = queries.get_impact("target.py", min_confidence="medium")

        assert "high_dep.py" in report.affected_files
        assert "medium_dep.py" in report.affected_files
        assert "low_dep.py" not in report.affected_files

    def test_no_confidence_filter_includes_all(self) -> None:
        """Without min_confidence, all dependents should appear."""
        queries = self._build_mixed_confidence_graph()
        report = queries.get_impact("target.py")

        assert "high_dep.py" in report.affected_files
        assert "medium_dep.py" in report.affected_files
        assert "low_dep.py" in report.affected_files


# ---------------------------------------------------------------------------
# Tests — Circular Dependencies
# ---------------------------------------------------------------------------

class TestCircularDependencies:
    """Impact analysis should handle cycles without infinite loops."""

    def test_cycle_does_not_hang(self) -> None:
        """A cycle in the graph should not cause an infinite loop."""
        builder = GraphBuilder()

        nodes = [
            GraphNode(id="x.py", type=NodeType.FILE, file_path="x.py", line_number=1, name="x.py"),
            GraphNode(id="y.py", type=NodeType.FILE, file_path="y.py", line_number=1, name="y.py"),
        ]

        # x imports y, y imports x (mutual cycle)
        edges = [
            GraphEdge(from_node="x.py", to_node="y.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.HIGH, line_number=1, label="import y"),
            GraphEdge(from_node="y.py", to_node="x.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.HIGH, line_number=1, label="import x"),
        ]

        graph = builder.build(nodes, edges)
        queries = GraphQueries(graph)

        # Should complete without hanging
        report = queries.get_impact("x.py")

        assert "y.py" in report.affected_files
        assert report.has_circular_dependencies is True


# ---------------------------------------------------------------------------
# Tests — Suggested Tests
# ---------------------------------------------------------------------------

class TestSuggestedTests:
    """Impact report should suggest test files among affected files."""

    def test_test_file_appears_in_suggested_tests(self) -> None:
        """If a test file depends on the changed module, it should appear in suggested_tests."""
        builder = GraphBuilder()

        nodes = [
            GraphNode(id="module.py", type=NodeType.FILE, file_path="module.py", line_number=1, name="module.py"),
            GraphNode(id="test_module.py", type=NodeType.FILE, file_path="test_module.py", line_number=1, name="test_module.py"),
        ]

        edges = [
            GraphEdge(from_node="test_module.py", to_node="module.py", edge_type=EdgeType.IMPORT, confidence=EdgeConfidence.HIGH, line_number=1, label="import module"),
        ]

        graph = builder.build(nodes, edges)
        queries = GraphQueries(graph)
        report = queries.get_impact("module.py")

        assert "test_module.py" in report.suggested_tests

    def test_non_test_file_not_in_suggested_tests(self) -> None:
        """Regular files should not appear in suggested_tests."""
        queries = _build_linear_chain()
        report = queries.get_impact("module_a.py")

        # module_b.py and module_c.py are not test files
        assert report.suggested_tests == []


# ---------------------------------------------------------------------------
# Integration Test — Full Parse -> Build -> Query Pipeline
# ---------------------------------------------------------------------------

class TestFullPipeline:
    """Integration tests using the parser to build the graph and then query impact."""

    def test_parse_build_query_direct_impact(self, temp_project: Path) -> None:
        """Parse real Python files, build a graph, and verify direct impact analysis."""
        # Create module_a.py with a helper function
        module_a = temp_project / "module_a.py"
        module_a.write_text('''"""Module A with a helper function."""

def helper():
    """A helper function."""
    return 42
''')

        # Create module_b.py that imports and calls helper from module_a
        module_b = temp_project / "module_b.py"
        module_b.write_text('''"""Module B that uses module_a."""

from module_a import helper

def process():
    """Process using helper."""
    return helper()
''')

        # Parse both files
        parser = PythonParser()
        nodes_a, edges_a = parser.parse_file(module_a)

        parser_b = PythonParser()
        nodes_b, edges_b = parser_b.parse_file(module_b)

        # Combine and build graph (resolve bare module names to file paths)
        all_nodes = nodes_a + nodes_b
        all_edges = _resolve_edges(all_nodes, edges_a + edges_b)

        builder = GraphBuilder()
        graph = builder.build(all_nodes, all_edges)
        queries = GraphQueries(graph)

        # module_b imports module_a, so changing module_a's file should impact module_b
        report = queries.get_impact(str(module_a))

        assert str(module_b) in report.affected_files

    def test_parse_build_query_no_impact_on_unrelated(self, temp_project: Path) -> None:
        """Unrelated modules should not appear in impact analysis."""
        # Create two independent modules
        module_x = temp_project / "module_x.py"
        module_x.write_text('''"""Independent module X."""

def x_func():
    return "x"
''')

        module_y = temp_project / "module_y.py"
        module_y.write_text('''"""Independent module Y."""

def y_func():
    return "y"
''')

        parser_x = PythonParser()
        nodes_x, edges_x = parser_x.parse_file(module_x)

        parser_y = PythonParser()
        nodes_y, edges_y = parser_y.parse_file(module_y)

        all_nodes = nodes_x + nodes_y
        all_edges = edges_x + edges_y

        builder = GraphBuilder()
        graph = builder.build(all_nodes, all_edges)
        queries = GraphQueries(graph)

        report = queries.get_impact(str(module_x))

        # module_y does not depend on module_x
        assert str(module_y) not in report.affected_files

    def test_parse_build_query_transitive_with_test_file(self, temp_project: Path) -> None:
        """Full pipeline: parse files with a test file, verify transitive impact and suggested tests."""
        # Create a base module
        base = temp_project / "base.py"
        base.write_text('''"""Base module."""

def core_logic():
    """Core business logic."""
    return True
''')

        # Create a service that uses base
        service = temp_project / "service.py"
        service.write_text('''"""Service module."""

from base import core_logic

def serve():
    """Serve using core logic."""
    return core_logic()
''')

        # Create a test file that uses service
        test_file = temp_project / "test_service.py"
        test_file.write_text('''"""Tests for service."""

from service import serve

def test_serve():
    assert serve() is True
''')

        parser1 = PythonParser()
        nodes1, edges1 = parser1.parse_file(base)

        parser2 = PythonParser()
        nodes2, edges2 = parser2.parse_file(service)

        parser3 = PythonParser()
        nodes3, edges3 = parser3.parse_file(test_file)

        # Combine and build graph (resolve bare module names to file paths)
        all_nodes = nodes1 + nodes2 + nodes3
        all_edges = _resolve_edges(all_nodes, edges1 + edges2 + edges3)

        builder = GraphBuilder()
        graph = builder.build(all_nodes, all_edges)
        queries = GraphQueries(graph)

        # Changing base.py should impact service.py (direct) and test_service.py (transitive)
        report = queries.get_impact(str(base))

        assert str(service) in report.affected_files
        assert str(test_file) in report.affected_files
        assert str(test_file) in report.suggested_tests
