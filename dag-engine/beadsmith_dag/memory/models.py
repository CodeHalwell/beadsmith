"""Pydantic models for the agent memory system."""

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


def _generate_ulid() -> str:
    """Generate a ULID-like ID (timestamp + random).

    Produces a 26-character Crockford base32 string:
    10-char encoded timestamp + 16-char random component.
    """
    import random
    import string
    import time

    # Crockford base32 alphabet (excludes I, L, O, U)
    chars = string.digits + "ABCDEFGHJKMNPQRSTVWXYZ"
    t = int(time.time() * 1000)
    timestamp = ""
    for _ in range(10):
        timestamp = chars[t % 32] + timestamp
        t //= 32
    random_part = "".join(random.choices(chars, k=16))
    return timestamp + random_part


class MemoryType(str, Enum):
    """Type of memory record."""

    PATTERN = "pattern"
    ERROR_FIX = "error_fix"
    PREFERENCE = "preference"
    FILE_RELATIONSHIP = "file_relationship"
    STRATEGY = "strategy"
    FACT = "fact"


class MemoryTier(str, Enum):
    """Memory tier based on age and access patterns."""

    HOT = "hot"
    WARM = "warm"
    COLD = "cold"
    ARCHIVED = "archived"


class PolicyDecision(str, Enum):
    """Type of policy decision."""

    SAVE = "save"
    SKIP = "skip"
    RETRIEVE = "retrieve"
    COMPACT = "compact"
    PROMOTE = "promote"


class MemoryRecord(BaseModel):
    """A single memory record."""

    id: str = Field(default_factory=_generate_ulid)
    type: MemoryType
    content: str
    keywords: list[str] = Field(default_factory=list)
    source_task: str | None = None
    source_file: str | None = None
    generation: int = 0
    tier: MemoryTier = MemoryTier.HOT
    confidence: float = 1.0
    access_count: int = 0
    last_accessed_at: str | None = None
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    evolved_from: list[str] = Field(default_factory=list)


class MemoryEdge(BaseModel):
    """An edge in the memory graph."""

    from_id: str
    to_id: str
    edge_type: str
    weight: float = 1.0
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class PolicyLogEntry(BaseModel):
    """A policy decision log entry."""

    decision: PolicyDecision
    memory_id: str | None = None
    context: str | None = None
    outcome: str = "pending"
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class RecallResult(BaseModel):
    """A single result from memory recall."""

    memory: MemoryRecord
    score: float
    source: str


class RecallResponse(BaseModel):
    """Response from a memory recall query."""

    results: list[RecallResult] = Field(default_factory=list)
    query: str
    total_searched: int = 0


class MemoryStats(BaseModel):
    """Statistics about the memory store."""

    total_count: int = 0
    hot_count: int = 0
    warm_count: int = 0
    cold_count: int = 0
    archived_count: int = 0
    total_edges: int = 0
    has_embeddings: bool = False
    top_keywords: list[str] = Field(default_factory=list)
