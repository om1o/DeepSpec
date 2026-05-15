from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chunk
from app.schemas.types import (
    Citation,
    IncompleteData,
    PhysicalSpecs,
    RiskGate,
    TechnicalData,
    VerificationBlock,
    VerificationResult,
    VerificationSignals,
)
from app.services.catalog.base import CatalogHit
from app.services.ocr_shield import OCRFusionResult
from app.services.rag.bm25 import BM25Index, RetrievedChunk, retrieval_overlap_score
from app.services.storage import sha256_prefixed


_PIN_HINT = re.compile(
    r"\b(pin|pins|terminal|terminals|connector|wiring|wire|ground|power|ignition|battery|switched)\b",
    re.IGNORECASE,
)
_DIM_HINT = re.compile(r"\b(dimension|dimensions|dia\.|ø|mm|inch|in\b|kg|g\b|mass|weight)\b", re.IGNORECASE)
_MAT_HINT = re.compile(r"\b(material|alloy|composition|plastic|steel|copper|brass|aluminum|aluminium)\b", re.IGNORECASE)


def _window(text: str, idx: int, radius: int = 220) -> str:
    lo = max(0, idx - radius)
    hi = min(len(text), idx + radius)
    excerpt = text[lo:hi].strip()
    return excerpt[:3900]


def _find_window_for_regex(text: str, pattern: re.Pattern[str]) -> tuple[int, str] | None:
    m = pattern.search(text)
    if not m:
        return None
    return m.start(), _window(text, m.start())


async def load_chunks(session: AsyncSession, *, document_ids: list[UUID]) -> list[Chunk]:
    if not document_ids:
        return []
    res = await session.execute(select(Chunk).where(Chunk.document_id.in_(document_ids)))
    return list(res.scalars().all())


def build_index(db_chunks: list[Chunk]) -> BM25Index:
    chunks = [
        RetrievedChunk(chunk_id=c.id, document_id=c.document_id, page=c.page, text=c.text, score=0.0) for c in db_chunks
    ]
    return BM25Index(chunks)


def _pick_top_chunks(index: BM25Index, query: str, *, top_k: int) -> list[RetrievedChunk]:
    return index.query(query, top_k=top_k)


def _chunk_text_map(db_chunks: list[Chunk]) -> dict[UUID, Chunk]:
    return {c.id: c for c in db_chunks}


def _mk_citation(*, chunk: Chunk, excerpt: str, url_archived: str | None = None) -> Citation:
    ex = excerpt.strip()
    return Citation(
        source_type="manual_pdf",
        document_id=str(chunk.document_id),
        page=int(chunk.page),
        excerpt=ex,
        excerpt_hash=sha256_prefixed(ex.encode("utf-8")),
        url_archived=url_archived,
    )


class GroundedExtractor:
    """Deterministic excerpt-only extraction (swap model calls behind this boundary later)."""

    def __init__(self, *, incomplete: IncompleteData | None, fusion: OCRFusionResult, catalog_hit: CatalogHit | None):
        self.incomplete = incomplete
        self.fusion = fusion
        self.catalog_hit = catalog_hit

    async def extract(
        self,
        session: AsyncSession,
        *,
        document_ids: list[UUID],
        url_by_document_id: dict[UUID, str | None],
    ) -> VerificationResult:
        db_chunks = await load_chunks(session, document_ids=document_ids)
        index = build_index(db_chunks)
        id_to_chunk = _chunk_text_map(db_chunks)

        mpn = (
            self.catalog_hit.matched_mpn
            if self.catalog_hit
            else (self.fusion.normalized_candidates[0] if self.fusion.normalized_candidates else "UNKNOWN")
        )

        q_base = f"{mpn} alternator wiring connector specifications manual datasheet"

        top_for_overlap = _pick_top_chunks(index, q_base, top_k=10)
        overlap = retrieval_overlap_score([c.score for c in top_for_overlap])

        purpose_chunks = _pick_top_chunks(index, f"{mpn} function purpose operation overview description", top_k=4)
        functional_purpose = "Requires manual verification"
        purpose_cites: list[Citation] = []
        if purpose_chunks:
            ch_id = purpose_chunks[0].chunk_id
            ch = id_to_chunk[ch_id]
            excerpt = purpose_chunks[0].text.strip()
            functional_purpose = excerpt.split("\n")[0][:420]
            purpose_cites.append(_mk_citation(chunk=ch, excerpt=excerpt, url_archived=url_by_document_id.get(ch.document_id)))

        mat_chunks = _pick_top_chunks(index, f"{mpn} material alloy composition polymer steel copper brass aluminum plastic", top_k=8)
        materials: list[str] = []
        mat_cites: list[Citation] = []
        seen_mat_pages: set[tuple[UUID, int]] = set()
        for rc in mat_chunks:
            ch = id_to_chunk[rc.chunk_id]
            hit = _find_window_for_regex(ch.text, _MAT_HINT)
            if not hit:
                continue
            _, excerpt = hit
            key = (ch.document_id, ch.page)
            if key in seen_mat_pages:
                continue
            seen_mat_pages.add(key)
            materials.append(excerpt[:280])
            mat_cites.append(_mk_citation(chunk=ch, excerpt=excerpt, url_archived=url_by_document_id.get(ch.document_id)))
            if len(materials) >= 3:
                break

        dim_chunks = _pick_top_chunks(index, f"{mpn} dimensions weight mass size mm inch kg grams", top_k=8)
        dimensions_weight = "Requires manual verification"
        dim_cites: list[Citation] = []
        for rc in dim_chunks:
            ch = id_to_chunk[rc.chunk_id]
            hit = _find_window_for_regex(ch.text, _DIM_HINT)
            if not hit:
                continue
            _, excerpt = hit
            dimensions_weight = excerpt[:420]
            dim_cites.append(_mk_citation(chunk=ch, excerpt=excerpt, url_archived=url_by_document_id.get(ch.document_id)))
            break

        pin_query_chunks = _pick_top_chunks(index, f"{mpn} pin wiring connector terminal diagram pinout harness", top_k=12)
        wiring_pinout = "Requires manual verification"
        pin_cites: list[Citation] = []
        pin_evidence_chunks: set[UUID] = set()

        for rc in pin_query_chunks:
            ch = id_to_chunk[rc.chunk_id]
            if not _PIN_HINT.search(ch.text):
                continue
            m = _PIN_HINT.search(ch.text)
            assert m is not None
            excerpt = _window(ch.text, m.start())
            pin_evidence_chunks.add(ch.id)
            pin_cites.append(_mk_citation(chunk=ch, excerpt=excerpt, url_archived=url_by_document_id.get(ch.document_id)))

        dup_agreement = min(1.0, len(pin_evidence_chunks) / 2.0)

        if len(pin_evidence_chunks) >= 2:
            excerpts = [c.excerpt for c in pin_cites[:2]]
            wiring_pinout = " | ".join(excerpts)[:900]

        compatibility_set: list[str] = []
        compat_chunks = _pick_top_chunks(index, f"{mpn} compatible applications interchange replaces replacement part numbers", top_k=6)
        compat_cites: list[Citation] = []
        for rc in compat_chunks[:2]:
            ch = id_to_chunk[rc.chunk_id]
            excerpt_line = rc.text.strip().split("\n")[0][:320]
            compatibility_set.append(excerpt_line)
            compat_cites.append(_mk_citation(chunk=ch, excerpt=rc.text.strip()[:900], url_archived=url_by_document_id.get(ch.document_id)))

        citations = [*purpose_cites, *mat_cites, *dim_cites, *pin_cites, *compat_cites]

        catalog_agreement = float(self.catalog_hit.confidence) if self.catalog_hit else 0.0

        signals = VerificationSignals(
            ocr_consensus=float(self.fusion.ocr_consensus),
            catalog_agreement=float(catalog_agreement),
            retrieval_overlap=float(overlap),
            duplicate_evidence_agreement=float(dup_agreement),
        )

        composite = (
            0.35 * signals.ocr_consensus
            + 0.25 * signals.catalog_agreement
            + 0.25 * signals.retrieval_overlap
            + 0.15 * signals.duplicate_evidence_agreement
        )

        source_verified = bool(citations) and composite >= 0.55

        inc = self.incomplete if self.incomplete else self.fusion.incomplete_data

        risk_reasons: list[str] = []

        human_review_required = False
        if inc:
            human_review_required = True
            risk_reasons.append("Incomplete capture quality gate triggered.")

        if self.fusion.conflicts:
            human_review_required = True
            risk_reasons.append("Identifier fusion conflicts detected between OCR and barcode signals.")

        if composite < 0.62:
            human_review_required = True
            risk_reasons.append("Composite verification score below release threshold.")

        if wiring_pinout != "Requires manual verification" and len(pin_evidence_chunks) < 2:
            human_review_required = True
            risk_reasons.append("Pinout excerpts require dual independent chunk corroboration.")

        action_required = (
            "Review Source HUD citations and resolve fusion conflicts or rescan if needed."
            if human_review_required
            else "Grounded excerpts appear sufficient for technician review; archive dossier with job packet."
        )

        physical = PhysicalSpecs(
            material_composition=materials or ["Requires manual verification"],
            dimensions_weight=dimensions_weight,
        )
        technical = TechnicalData(
            functional_purpose=functional_purpose,
            wiring_pinout=wiring_pinout,
            compatibility_set=compatibility_set or ["Requires manual verification"],
        )

        verification = VerificationBlock(
            composite_score=float(round(composite, 4)),
            source_verified=bool(source_verified),
            matched_mpn=mpn if mpn != "UNKNOWN" else None,
            signals=signals,
        )

        return VerificationResult(
            verification=verification,
            physical_specs=physical,
            technical_data=technical,
            action_required=action_required,
            citations=citations,
            risk_gate=RiskGate(human_review_required=human_review_required, reasons=sorted(set(risk_reasons))),
            incomplete_data=inc,
        )
