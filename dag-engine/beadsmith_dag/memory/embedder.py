"""Vector embedding wrapper using sentence-transformers."""

import math

import structlog

logger = structlog.get_logger()


class Embedder:
    """Generate text embeddings for semantic search.

    Falls back gracefully if sentence-transformers is not installed.
    """

    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        self._model = None
        self._available = False
        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(model_name)
            self._available = True
            logger.info("Embedder initialized", model=model_name)
        except Exception as e:
            logger.warning(
                "Embedder unavailable, falling back to keyword-only search",
                error=str(e),
            )

    @property
    def available(self) -> bool:
        return self._available

    def embed(self, text: str) -> list[float]:
        """Embed a single text string."""
        if not self._available or self._model is None:
            return []
        vec = self._model.encode(text, convert_to_numpy=True)
        return vec.tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts."""
        if not self._available or self._model is None:
            return []
        vecs = self._model.encode(texts, convert_to_numpy=True)
        return [v.tolist() for v in vecs]

    @staticmethod
    def cosine_similarity(a: list[float], b: list[float]) -> float:
        """Compute cosine similarity between two vectors."""
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)
