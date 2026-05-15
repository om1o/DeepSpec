from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class ScanCreateResponse(BaseModel):
    scan_id: UUID
    fusion: dict


class FetchUrlBody(BaseModel):
    url: HttpUrl


class DocumentSummary(BaseModel):
    id: UUID
    title: str
    storage_key: str
    source_url: str | None
    content_sha256: str


class ExtractBody(BaseModel):
    scan_id: UUID
    document_ids: list[UUID] = Field(default_factory=list)


class ExtractResponse(BaseModel):
    extraction_id: UUID
    result: dict


class ApproveBody(BaseModel):
    approved_by: str = Field(min_length=1, max_length=256)


class AuditEntry(BaseModel):
    id: UUID
    event_type: str
    payload: dict
    created_at: str


class HealthResponse(BaseModel):
    status: str
