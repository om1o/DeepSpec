from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.db.session import get_db
from app.models import Document, ExtractionRun, Scan
from app.schemas.api_models import ApproveBody, ExtractBody, ExtractResponse
from app.schemas.types import VerificationResult
from app.services.audit import record_audit
from app.services.catalog.base import StubCatalogConnector
from app.services.dossier_pdf import render_verification_dossier_pdf
from app.services.ocr_shield import fusion_payload_to_result
from app.services.rag.extractor import GroundedExtractor

router = APIRouter(prefix="/extractions", tags=["extractions"])

_catalog = StubCatalogConnector()


@router.post("", response_model=ExtractResponse)
async def create_extraction(body: ExtractBody, session: AsyncSession = Depends(get_db)) -> ExtractResponse:
    if not body.document_ids:
        raise HTTPException(status_code=400, detail="document_ids must include at least one archived manual.")

    scan = await session.get(Scan, body.scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found.")

    fusion = fusion_payload_to_result(dict(scan.fusion_payload or {}))
    hit = await _catalog.resolve(normalized_candidates=fusion.normalized_candidates)

    res = await session.execute(select(Document).where(Document.id.in_(body.document_ids)))
    docs = list(res.scalars().all())
    if len(docs) != len(set(body.document_ids)):
        raise HTTPException(status_code=404, detail="One or more documents were not found.")

    url_map = {d.id: d.source_url for d in docs}

    extractor = GroundedExtractor(incomplete=None, fusion=fusion, catalog_hit=hit)
    result = await extractor.extract(session, document_ids=body.document_ids, url_by_document_id=url_map)

    run_id = uuid.uuid4()
    run = ExtractionRun(
        id=run_id,
        scan_id=scan.id,
        document_ids=[str(x) for x in body.document_ids],
        result_payload=result.model_dump(mode="json"),
        human_review_required=bool(result.risk_gate.human_review_required),
        human_review_reasons=list(result.risk_gate.reasons),
    )
    session.add(run)

    await record_audit(
        session,
        event_type="extraction_completed",
        payload={
            "extraction_id": str(run_id),
            "scan_id": str(scan.id),
            "human_review_required": run.human_review_required,
            "composite_score": result.verification.composite_score,
        },
    )
    await session.commit()

    return ExtractResponse(extraction_id=run_id, result=run.result_payload)


@router.get("/{extraction_id}", response_model=dict)
async def get_extraction(extraction_id: UUID, session: AsyncSession = Depends(get_db)) -> dict:
    row = await session.get(ExtractionRun, extraction_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Extraction not found.")
    return dict(row.result_payload or {})


@router.get("/{extraction_id}/dossier.pdf")
async def download_dossier(extraction_id: UUID, session: AsyncSession = Depends(get_db)) -> Response:
    row = await session.get(ExtractionRun, extraction_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Extraction not found.")

    result = VerificationResult.model_validate(row.result_payload)
    pdf_bytes = render_verification_dossier_pdf(result)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="deepspec-dossier-{str(extraction_id)}.pdf"'},
    )


@router.patch("/{extraction_id}/approve")
async def approve_extraction(
    extraction_id: UUID,
    body: ApproveBody,
    session: AsyncSession = Depends(get_db),
) -> dict:
    row = await session.get(ExtractionRun, extraction_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Extraction not found.")

    result = VerificationResult.model_validate(row.result_payload)
    result.risk_gate.human_review_required = False
    result.risk_gate.reasons = []

    row.result_payload = result.model_dump(mode="json")
    row.human_review_required = False
    row.human_review_reasons = []
    row.approved_at = datetime.now(timezone.utc)
    row.approved_by = body.approved_by

    await record_audit(
        session,
        event_type="extraction_approved",
        payload={"extraction_id": str(row.id), "approved_by": body.approved_by},
    )
    await session.commit()

    return {"status": "approved", "extraction_id": str(row.id)}
