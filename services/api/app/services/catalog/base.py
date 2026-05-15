from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass(frozen=True)
class CatalogHit:
    matched_mpn: str
    manufacturer: str | None
    confidence: float  # 0..1
    source: str


class CatalogConnector(ABC):
    """Pluggable connector for Tier 1 distributor/OEM catalogs."""

    name: str

    @abstractmethod
    async def resolve(self, *, normalized_candidates: list[str]) -> CatalogHit | None:
        raise NotImplementedError


class StubCatalogConnector(CatalogConnector):
    """Deterministic demo resolver for MVP wiring/tests."""

    name = "stub_catalog"

    async def resolve(self, *, normalized_candidates: list[str]) -> CatalogHit | None:
        if not normalized_candidates:
            return None
        primary = normalized_candidates[0]
        # naive confidence curve: longer identifiers look more specific
        conf = min(1.0, 0.55 + min(len(primary), 18) * 0.02)
        return CatalogHit(matched_mpn=primary, manufacturer=None, confidence=conf, source=self.name)


def catalog_agreement_score(hit: CatalogHit | None) -> float:
    return float(hit.confidence) if hit else 0.0


def matched_mpn(hit: CatalogHit | None) -> str | None:
    return hit.matched_mpn if hit else None
