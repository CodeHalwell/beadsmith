"""Tests for the memory embedder."""

import pytest

from beadsmith_dag.memory.embedder import Embedder


class TestEmbedder:
    def test_embed_returns_list_of_floats(self) -> None:
        embedder = Embedder()
        if not embedder.available:
            pytest.skip("sentence-transformers not installed")
        vec = embedder.embed("This project uses biome for linting")
        assert isinstance(vec, list)
        assert len(vec) == 384  # all-MiniLM-L6-v2 dimension
        assert all(isinstance(v, float) for v in vec)

    def test_embed_batch(self) -> None:
        embedder = Embedder()
        if not embedder.available:
            pytest.skip("sentence-transformers not installed")
        texts = ["hello world", "VSIX packaging error"]
        vecs = embedder.embed_batch(texts)
        assert len(vecs) == 2
        assert len(vecs[0]) == 384

    def test_similarity_related_texts(self) -> None:
        embedder = Embedder()
        if not embedder.available:
            pytest.skip("sentence-transformers not installed")
        v1 = embedder.embed("fix VSIX packaging SVG error")
        v2 = embedder.embed("VSIX build fails because of SVG in readme")
        v3 = embedder.embed("python asyncio event loop tutorial")
        sim_related = embedder.cosine_similarity(v1, v2)
        sim_unrelated = embedder.cosine_similarity(v1, v3)
        assert sim_related > sim_unrelated

    def test_unavailable_returns_empty(self) -> None:
        embedder = Embedder(model_name="nonexistent/model/xyz")
        assert not embedder.available
        assert embedder.embed("test") == []
        assert embedder.embed_batch(["test"]) == []
