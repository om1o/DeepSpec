from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document


async def list_manual_documents(session: AsyncSession, *, limit: int = 100) -> list[Document]:
    res = await session.execute(select(Document).order_by(Document.created_at.desc()).limit(limit))
    return list(res.scalars().all())
