"""SQLite-backed memory store with FTS5 full-text search."""

import json
import sqlite3
import struct
from datetime import datetime, timezone

import structlog

from .models import MemoryRecord, MemoryStats, MemoryTier, MemoryType

logger = structlog.get_logger()


_ALLOWED_UPDATE_FIELDS = frozenset({
    "content", "keywords", "type", "source_task", "source_file",
    "generation", "tier", "confidence", "access_count",
    "last_accessed_at", "evolved_from",
})


class MemoryStore:
    """SQLite storage for memory records with FTS5 keyword search."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._conn: sqlite3.Connection | None = None

    def initialize(self) -> None:
        """Create tables and FTS index."""
        self._conn = sqlite3.connect(self.db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._create_tables()

        self.vec_available = False
        try:
            import sqlite_vec

            self._conn.enable_load_extension(True)
            sqlite_vec.load(self._conn)
            self._conn.enable_load_extension(False)
            self._conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
                    embedding float[384],
                    memory_id text
                )
            """)
            self._conn.commit()
            self.vec_available = True
            logger.info("sqlite-vec loaded successfully")
        except Exception as e:
            logger.warning("sqlite-vec unavailable, semantic search disabled", error=str(e))

    def _create_tables(self) -> None:
        assert self._conn is not None
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS memories (
                id          TEXT PRIMARY KEY,
                type        TEXT NOT NULL,
                content     TEXT NOT NULL,
                keywords    TEXT NOT NULL DEFAULT '[]',
                source_task TEXT,
                source_file TEXT,
                generation  INTEGER DEFAULT 0,
                tier        TEXT DEFAULT 'hot',
                confidence  REAL DEFAULT 1.0,
                access_count INTEGER DEFAULT 0,
                last_accessed_at TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                evolved_from TEXT DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS memory_edges (
                from_id     TEXT NOT NULL,
                to_id       TEXT NOT NULL,
                edge_type   TEXT NOT NULL,
                weight      REAL DEFAULT 1.0,
                created_at  TEXT NOT NULL,
                PRIMARY KEY (from_id, to_id, edge_type)
            );

            CREATE TABLE IF NOT EXISTS policy_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                decision    TEXT NOT NULL,
                memory_id   TEXT,
                context     TEXT,
                outcome     TEXT DEFAULT 'pending',
                created_at  TEXT NOT NULL
            );
        """)
        # FTS5 virtual table for keyword search
        self._conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                content, keywords, type,
                content='memories', content_rowid='rowid'
            )
        """)
        # Triggers to keep FTS in sync
        self._conn.executescript("""
            CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memories BEGIN
                INSERT INTO memory_fts(rowid, content, keywords, type)
                VALUES (new.rowid, new.content, new.keywords, new.type);
            END;
            CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memories BEGIN
                INSERT INTO memory_fts(memory_fts, rowid, content, keywords, type)
                VALUES ('delete', old.rowid, old.content, old.keywords, old.type);
            END;
            CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memories BEGIN
                INSERT INTO memory_fts(memory_fts, rowid, content, keywords, type)
                VALUES ('delete', old.rowid, old.content, old.keywords, old.type);
                INSERT INTO memory_fts(rowid, content, keywords, type)
                VALUES (new.rowid, new.content, new.keywords, new.type);
            END;
        """)
        self._conn.commit()

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError("Store not initialized. Call initialize() first.")
        return self._conn

    def save(self, record: MemoryRecord) -> None:
        """Save a memory record."""
        self.conn.execute(
            """INSERT OR REPLACE INTO memories
               (id, type, content, keywords, source_task, source_file,
                generation, tier, confidence, access_count, last_accessed_at,
                created_at, updated_at, evolved_from)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.id, record.type.value, record.content,
                json.dumps(record.keywords), record.source_task, record.source_file,
                record.generation, record.tier.value, record.confidence,
                record.access_count, record.last_accessed_at,
                record.created_at, record.updated_at,
                json.dumps(record.evolved_from),
            ),
        )
        self.conn.commit()

    def get(self, memory_id: str) -> MemoryRecord | None:
        """Get a memory by ID."""
        row = self.conn.execute(
            "SELECT * FROM memories WHERE id = ?", (memory_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_record(row)

    def update(self, memory_id: str, **fields: object) -> None:
        """Update specific fields of a memory."""
        now = datetime.now(timezone.utc).isoformat()
        sets = ["updated_at = ?"]
        values: list[object] = [now]
        for key, value in fields.items():
            if key not in _ALLOWED_UPDATE_FIELDS:
                raise ValueError(f"Cannot update field: {key}")
            if key == "tier" and isinstance(value, MemoryTier):
                value = value.value
            elif key == "keywords" and isinstance(value, list):
                value = json.dumps(value)
            elif key == "evolved_from" and isinstance(value, list):
                value = json.dumps(value)
            sets.append(f"{key} = ?")
            values.append(value)
        values.append(memory_id)
        self.conn.execute(
            f"UPDATE memories SET {', '.join(sets)} WHERE id = ?", values
        )
        self.conn.commit()

    def delete(self, memory_id: str) -> None:
        """Delete a memory."""
        self.conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        self.conn.commit()

    def list_all(
        self,
        tier: MemoryTier | None = None,
        memory_type: MemoryType | None = None,
        limit: int = 100,
    ) -> list[MemoryRecord]:
        """List memories with optional filters."""
        query = "SELECT * FROM memories WHERE 1=1"
        params: list[object] = []
        if tier is not None:
            query += " AND tier = ?"
            params.append(tier.value)
        if memory_type is not None:
            query += " AND type = ?"
            params.append(memory_type.value)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = self.conn.execute(query, params).fetchall()
        return [self._row_to_record(r) for r in rows]

    def list_by_file(self, file_path: str, limit: int = 100) -> list[MemoryRecord]:
        """List memories associated with a specific file."""
        rows = self.conn.execute(
            "SELECT * FROM memories WHERE source_file = ? ORDER BY created_at DESC LIMIT ?",
            (file_path, limit),
        ).fetchall()
        return [self._row_to_record(r) for r in rows]

    def record_access(self, memory_id: str) -> None:
        """Increment access count and update last_accessed_at."""
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            """UPDATE memories
               SET access_count = access_count + 1,
                   last_accessed_at = ?,
                   updated_at = ?
               WHERE id = ?""",
            (now, now, memory_id),
        )
        self.conn.commit()

    def search_keyword(self, query: str, limit: int = 10) -> list[MemoryRecord]:
        """Search memories using FTS5 keyword matching."""
        rows = self.conn.execute(
            """SELECT m.* FROM memory_fts f
               JOIN memories m ON m.rowid = f.rowid
               WHERE memory_fts MATCH ?
               ORDER BY rank
               LIMIT ?""",
            (query, limit),
        ).fetchall()
        return [self._row_to_record(r) for r in rows]

    def get_stats(self) -> MemoryStats:
        """Get memory store statistics."""
        row = self.conn.execute("""
            SELECT
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN tier = 'hot' THEN 1 ELSE 0 END), 0) as hot,
                COALESCE(SUM(CASE WHEN tier = 'warm' THEN 1 ELSE 0 END), 0) as warm,
                COALESCE(SUM(CASE WHEN tier = 'cold' THEN 1 ELSE 0 END), 0) as cold,
                COALESCE(SUM(CASE WHEN tier = 'archived' THEN 1 ELSE 0 END), 0) as archived
            FROM memories
        """).fetchone()
        edge_count = self.conn.execute(
            "SELECT COUNT(*) FROM memory_edges"
        ).fetchone()[0]
        return MemoryStats(
            total_count=row["total"],
            hot_count=row["hot"],
            warm_count=row["warm"],
            cold_count=row["cold"],
            archived_count=row["archived"],
            total_edges=edge_count,
        )

    def save_embedding(self, memory_id: str, embedding: list[float]) -> None:
        """Save a vector embedding for a memory."""
        if not self.vec_available:
            return
        blob = struct.pack(f"<{len(embedding)}f", *embedding)
        self.conn.execute("DELETE FROM memory_vec WHERE memory_id = ?", (memory_id,))
        self.conn.execute(
            "INSERT INTO memory_vec(embedding, memory_id) VALUES (?, ?)",
            (blob, memory_id),
        )
        self.conn.commit()

    def search_vec(self, query_vec: list[float], limit: int = 10) -> list[tuple[str, float]]:
        """Search for nearest vectors. Returns (memory_id, distance) pairs."""
        if not self.vec_available:
            return []
        blob = struct.pack(f"<{len(query_vec)}f", *query_vec)
        rows = self.conn.execute(
            "SELECT memory_id, distance FROM memory_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
            (blob, limit),
        ).fetchall()
        return [(row[0], row[1]) for row in rows]

    def delete_embedding(self, memory_id: str) -> None:
        """Delete a vector embedding for a memory."""
        if not self.vec_available:
            return
        self.conn.execute("DELETE FROM memory_vec WHERE memory_id = ?", (memory_id,))
        self.conn.commit()

    def close(self) -> None:
        """Close the database connection."""
        if self._conn:
            self._conn.close()
            self._conn = None

    def _row_to_record(self, row: sqlite3.Row) -> MemoryRecord:
        """Convert a database row to a MemoryRecord."""
        return MemoryRecord(
            id=row["id"],
            type=MemoryType(row["type"]),
            content=row["content"],
            keywords=json.loads(row["keywords"]),
            source_task=row["source_task"],
            source_file=row["source_file"],
            generation=row["generation"],
            tier=MemoryTier(row["tier"]),
            confidence=row["confidence"],
            access_count=row["access_count"],
            last_accessed_at=row["last_accessed_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            evolved_from=json.loads(row["evolved_from"]),
        )
