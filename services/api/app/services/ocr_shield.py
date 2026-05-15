from __future__ import annotations

import re
from dataclasses import dataclass

from app.schemas.types import IncompleteData


_MPN_LIKE = re.compile(r"\b[A-Z0-9][A-Z0-9\-_/]{4,}\b", re.IGNORECASE)


def _normalize_token(s: str) -> str:
    t = re.sub(r"\s+", "", s.strip()).upper()
    t = t.replace("/", "-")
    return t


def _extract_candidates_from_lines(lines: list[str]) -> list[str]:
    found: list[str] = []
    for line in lines:
        for m in _MPN_LIKE.findall(line):
            norm = _normalize_token(m)
            if norm not in found:
                found.append(norm)
    return found[:25]


def _consensus_score(candidates: list[str]) -> float:
    if not candidates:
        return 0.0
    if len(candidates) == 1:
        return 1.0
    # penalize multiplicity
    return max(0.35, 1.0 - 0.15 * (len(candidates) - 1))


@dataclass(frozen=True)
class OCRFusionResult:
    incomplete_data: IncompleteData | None
    normalized_candidates: list[str]
    barcode_candidate: str | None
    ocr_candidates: list[str]
    conflicts: list[str]
    blur_score: float | None
    ocr_consensus: float


def fusion_result_to_payload(fr: OCRFusionResult) -> dict:
    return {
        "incomplete_data": fr.incomplete_data.model_dump() if fr.incomplete_data else None,
        "normalized_candidates": fr.normalized_candidates,
        "barcode_candidate": fr.barcode_candidate,
        "ocr_candidates": fr.ocr_candidates,
        "conflicts": fr.conflicts,
        "blur_score": fr.blur_score,
        "ocr_consensus": fr.ocr_consensus,
    }


def fusion_payload_to_result(payload: dict) -> OCRFusionResult:
    inc_raw = payload.get("incomplete_data")
    incomplete = IncompleteData(**inc_raw) if isinstance(inc_raw, dict) else None
    return OCRFusionResult(
        incomplete_data=incomplete,
        normalized_candidates=list(payload.get("normalized_candidates") or []),
        barcode_candidate=payload.get("barcode_candidate"),
        ocr_candidates=list(payload.get("ocr_candidates") or []),
        conflicts=list(payload.get("conflicts") or []),
        blur_score=payload.get("blur_score"),
        ocr_consensus=float(payload.get("ocr_consensus") or 0.0),
    )


def fuse_signals(
    *,
    barcode_text: str | None,
    ocr_lines: list[str] | None,
    blur_score: float | None,
    blur_threshold: float = 0.35,
) -> OCRFusionResult:
    """Parallel OCR/barcode fusion with blur gate + conflict detection."""

    conflicts: list[str] = []
    incomplete: IncompleteData | None = None

    lines = [ln for ln in (ocr_lines or []) if ln and ln.strip()]
    ocr_candidates = _extract_candidates_from_lines(lines)

    barcode_candidate = _normalize_token(barcode_text) if barcode_text and barcode_text.strip() else None

    if blur_score is not None and blur_score < blur_threshold:
        incomplete = IncompleteData(
            message="Incomplete Data",
            camera_guidance=(
                "Move closer to the stamped part number plate, enable macro mode if available, "
                "and hold the camera steady until the text looks sharp."
            ),
        )

    merged: list[str] = []
    if barcode_candidate:
        merged.append(barcode_candidate)
    for c in ocr_candidates:
        if c not in merged:
            merged.append(c)

    if barcode_candidate and ocr_candidates:
        best = None
        for oc in ocr_candidates:
            if barcode_candidate == oc:
                best = oc
                break
            if oc and (barcode_candidate in oc or oc in barcode_candidate):
                best = oc
                break
        if best is None:
            conflicts.append("Barcode candidate disagrees with OCR-derived dominant identifiers.")

    consensus = _consensus_score(merged)

    return OCRFusionResult(
        incomplete_data=incomplete,
        normalized_candidates=merged,
        barcode_candidate=barcode_candidate,
        ocr_candidates=ocr_candidates,
        conflicts=conflicts,
        blur_score=blur_score,
        ocr_consensus=float(consensus),
    )


def material_auditor_stub(*, measured_mass_g: float | None, claimed_mass_g: float | None, tolerance_ratio: float = 0.12) -> dict:
    """Phase-2 hook: compare measured vs datasheet mass when both exist."""

    if measured_mass_g is None or claimed_mass_g is None:
        return {"status": "skipped", "reason": "missing_measurements"}

    delta = abs(measured_mass_g - claimed_mass_g) / max(claimed_mass_g, 1e-6)
    ok = delta <= tolerance_ratio
    return {"status": "pass" if ok else "fail", "relative_delta": delta}
