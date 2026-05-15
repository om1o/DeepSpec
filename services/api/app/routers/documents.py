from __future__ import annotations

import uuid
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Chunk, Document
from app.schemas.api_models import DocumentSummary, FetchUrlBody
from app.services.audit import record_audit
from app.services.rag.pdf_ingest import chunk_pdf_bytes
from app.services.storage import ensure_bucket, get_minio_client, put_bytes, sha256_hex

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_FETCH_BYTES = 25 * 1024 * 1024


async def ingest_pdf_bytes(
    session: AsyncSession,
    *,
    title: str,
    data: bytes,
    source_url: str | None,
) -> Document:
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Uploaded bytes are not a PDF (missing %PDF header).")

    doc_id = uuid.uuid4()
    storage_key = f"documents/{doc_id}.pdf"

    client = get_minio_client()
    ensure_bucket(client)
    put_bytes(client, storage_key, data, content_type="application/pdf")

    sha = sha256_hex(data)
    doc = Document(id=doc_id, title=title, storage_key=storage_key, source_url=source_url, content_sha256=sha)
    session.add(doc)

    chunks = chunk_pdf_bytes(data)
    for i, ch in enumerate(chunks):
        session.add(Chunk(document_id=doc_id, page=ch.page, chunk_index=i, text=ch.text))

    await record_audit(
        session,
        event_type="document_ingested",
        payload={"document_id": str(doc_id), "title": title, "source_url": source_url, "chunks": len(chunks)},
    )
    return doc


@router.get("", response_model=list[DocumentSummary])
async def list_documents(session: AsyncSession = Depends(get_db), limit: int = 50) -> list[DocumentSummary]:
    res = await session.execute(select(Document).order_by(Document.created_at.desc()).limit(limit))
    docs = list(res.scalars().all())
    return [
        DocumentSummary(
            id=d.id,
            title=d.title,
            storage_key=d.storage_key,
            source_url=d.source_url,
            content_sha256=d.content_sha256,
        )
        for d in docs
    ]


@router.post("/upload", response_model=DocumentSummary)
async def upload_document(
    session: AsyncSession = Depends(get_db),
    file: UploadFile = File(...),
) -> DocumentSummary:
    data = await file.read()
    title = file.filename or "manual.pdf"
    doc = await ingest_pdf_bytes(session, title=title, data=data, source_url=None)
    await session.commit()
    return DocumentSummary(
        id=doc.id,
        title=doc.title,
        storage_key=doc.storage_key,
        source_url=doc.source_url,
        content_sha256=doc.content_sha256,
    )


@router.post("/fetch-url", response_model=DocumentSummary)
async def fetch_document_url(body: FetchUrlBody, session: AsyncSession = Depends(get_db)) -> DocumentSummary:
    url = str(body.url)
    async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(30.0)) as client_http:
        resp = await client_http.get(url)
        resp.raise_for_status()
        data = resp.content
        if len(data) > MAX_FETCH_BYTES:
            raise HTTPException(status_code=413, detail="Remote PDF exceeds size cap for MVP fetch.")

    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="URL did not return a PDF (missing %PDF header).")

    path = urlparse(url).path or "manual.pdf"
    title = path.rsplit("/", 1)[-1] or "manual.pdf"

    doc = await ingest_pdf_bytes(session, title=title, data=data, source_url=url)
    await session.commit()
    return DocumentSummary(
        id=doc.id,
        title=doc.title,
        storage_key=doc.storage_key,
        source_url=doc.source_url,
        content_sha256=doc.content_sha256,
    )
