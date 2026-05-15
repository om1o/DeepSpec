from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Scan
from app.schemas.api_models import ScanCreateResponse
from app.services.audit import record_audit
from app.services.ocr_shield import fuse_signals, fusion_result_to_payload
from app.services.storage import ensure_bucket, get_minio_client, put_bytes, sha256_prefixed

router = APIRouter(prefix="/scans", tags=["scans"])


def _parse_ocr_lines(raw: str | None) -> list[str]:
    if not raw:
        return []
    raw = raw.strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            val = json.loads(raw)
            if isinstance(val, list):
                return [str(x) for x in val]
        except json.JSONDecodeError:
            pass
    return [ln.strip() for ln in raw.splitlines() if ln.strip()]


@router.post("", response_model=ScanCreateResponse)
async def create_scan(
    session: AsyncSession = Depends(get_db),
    image: UploadFile | None = File(default=None),
    barcode_text: str | None = Form(default=None),
    ocr_lines: str | None = Form(default=None),
    blur_score: float | None = Form(default=None),
) -> ScanCreateResponse:
    """OCR Shield entrypoint: fuse device signals + optional image retention in object storage."""

    lines = _parse_ocr_lines(ocr_lines)
    fused = fuse_signals(barcode_text=barcode_text, ocr_lines=lines, blur_score=blur_score)
    payload = fusion_result_to_payload(fused)

    scan_id = uuid.uuid4()
    image_key = None
    image_bytes: bytes | None = None

    if image is not None:
        image_bytes = await image.read()

    if image_bytes:
        client = get_minio_client()
        ensure_bucket(client)
        ext = ".bin"
        ct = image.content_type or ""
        if "jpeg" in ct or (image.filename and image.filename.lower().endswith((".jpg", ".jpeg"))):
            ext = ".jpg"
        elif "png" in ct or (image.filename and image.filename.lower().endswith(".png")):
            ext = ".png"
        image_key = f"scans/{scan_id}{ext}"
        put_bytes(client, image_key, image_bytes, content_type=ct or "application/octet-stream")

    row = Scan(id=scan_id, image_object_key=image_key, fusion_payload=payload)
    session.add(row)
    await record_audit(
        session,
        event_type="scan_created",
        payload={
            "scan_id": str(scan_id),
            "image_sha256": sha256_prefixed(image_bytes) if image_bytes else None,
        },
    )
    await session.commit()
    return ScanCreateResponse(scan_id=scan_id, fusion=payload)
