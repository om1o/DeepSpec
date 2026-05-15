from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def record_audit(session: AsyncSession, *, event_type: str, payload: dict[str, Any]) -> AuditLog:
    row = AuditLog(event_type=event_type, payload=payload)
    session.add(row)
    await session.flush()
    return row
