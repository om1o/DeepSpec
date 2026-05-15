from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from rank_bm25 import BM25Okapi


def _tok(s: str) -> list[str]:
    return [t for t in "".join(ch.lower() if ch.isalnum() else " " for ch in s).split() if t]


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: UUID
    document_id: UUID
    page: int
    text: str
    score: float


class BM25Index:
    def __init__(self, chunks: list[RetrievedChunk]):
        self.chunks = chunks
        corpus = [_tok(c.text) for c in chunks]
        self._bm25 = BM25Okapi(corpus) if corpus else None

    def query(self, q: str, *, top_k: int = 8) -> list[RetrievedChunk]:
        if not self._bm25 or not self.chunks:
            return []
        scores = self._bm25.get_scores(_tok(q))
        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
        out: list[RetrievedChunk] = []
        for i in ranked:
            out.append(
                RetrievedChunk(
                    chunk_id=self.chunks[i].chunk_id,
                    document_id=self.chunks[i].document_id,
                    page=self.chunks[i].page,
                    text=self.chunks[i].text,
                    score=float(scores[i]),
                )
            )
        return out


def retrieval_overlap_score(top_scores: list[float]) -> float:
    if not top_scores:
        return 0.0
    # normalize BM25 scores coarsely (non-negative but unbounded)
    best = max(top_scores)
    return float(min(1.0, best / (best + 3.0)))
