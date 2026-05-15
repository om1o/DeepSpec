from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import AuditLog
from app.schemas.api_models import AuditEntry

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/logs", response_model=list[AuditEntry])
async def list_audit_logs(session: AsyncSession = Depends(get_db), limit: int = 50) -> list[AuditEntry]:
    res = await session.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit))
    rows = list(res.scalars().all())
    return [
        AuditEntry(id=r.id, event_type=r.event_type, payload=dict(r.payload or {}), created_at=r.created_at.isoformat())
        for r in rows
    ]
