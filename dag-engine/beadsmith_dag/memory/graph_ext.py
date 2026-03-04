"""Memory graph extension using NetworkX."""

from datetime import datetime, timezone

import networkx as nx
import structlog

from .store import MemoryStore

logger = structlog.get_logger()


class MemoryGraph:
    """Graph-based memory relationships, persisted to SQLite."""

    def __init__(self, store: MemoryStore) -> None:
        self.store = store
        self.graph: nx.DiGraph = nx.DiGraph()
        self.load_from_store()

    def load_from_store(self) -> None:
        """Load all edges from SQLite into NetworkX."""
        self.graph = nx.DiGraph()
        rows = self.store.conn.execute(
            "SELECT from_id, to_id, edge_type, weight, created_at FROM memory_edges"
        ).fetchall()
        for row in rows:
            self.graph.add_edge(
                row["from_id"],
                row["to_id"],
                edge_type=row["edge_type"],
                weight=row["weight"],
                created_at=row["created_at"],
            )
        logger.info("Memory graph loaded", edges=len(rows))

    def add_edge(self, from_id: str, to_id: str, edge_type: str, weight: float = 1.0) -> None:
        """Add an edge to the memory graph and persist to SQLite."""
        now = datetime.now(timezone.utc).isoformat()
        self.graph.add_edge(from_id, to_id, edge_type=edge_type, weight=weight, created_at=now)
        self.store.conn.execute(
            """INSERT OR REPLACE INTO memory_edges (from_id, to_id, edge_type, weight, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (from_id, to_id, edge_type, weight, now),
        )
        self.store.conn.commit()

    def record_co_change(self, file_a: str, file_b: str) -> None:
        """Record that two files were changed together. Increments weight."""
        # Normalize order for consistency
        a, b = sorted([file_a, file_b])
        existing = self.store.conn.execute(
            "SELECT weight FROM memory_edges WHERE from_id=? AND to_id=? AND edge_type='co_changed'",
            (a, b),
        ).fetchone()
        new_weight = (existing["weight"] + 1.0) if existing else 1.0
        self.add_edge(a, b, "co_changed", weight=new_weight)

    def get_related(self, node_id: str, max_depth: int = 1) -> list[str]:
        """Get related nodes up to max_depth hops away."""
        if node_id not in self.graph:
            return []
        visited: set[str] = set()
        queue: list[tuple[str, int]] = [(node_id, 0)]
        result: list[str] = []
        while queue:
            current, depth = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            if current != node_id:
                result.append(current)
            if depth < max_depth:
                for neighbor in list(self.graph.successors(current)) + list(
                    self.graph.predecessors(current)
                ):
                    if neighbor not in visited:
                        queue.append((neighbor, depth + 1))
        return result

    def get_co_changes(self, file_path: str) -> list[tuple[str, float]]:
        """Get files that are frequently changed with the given file."""
        results: list[tuple[str, float]] = []
        for row in self.store.conn.execute(
            """SELECT from_id, to_id, weight FROM memory_edges
               WHERE (from_id=? OR to_id=?) AND edge_type='co_changed'
               ORDER BY weight DESC""",
            (file_path, file_path),
        ).fetchall():
            other = row["to_id"] if row["from_id"] == file_path else row["from_id"]
            results.append((other, row["weight"]))
        return results
