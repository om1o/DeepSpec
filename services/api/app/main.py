from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.base import Base
from app.db.session import engine
from app.models import AuditLog, Chunk, Document, ExtractionRun, Scan  # noqa: F401 - metadata registration
from app.routers import audit_router, documents, extractions, scans
from app.services.storage import ensure_bucket, get_minio_client


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    client = get_minio_client()
    ensure_bucket(client)
    yield


app = FastAPI(title="DeepSpec Pro API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scans.router)
app.include_router(documents.router)
app.include_router(extractions.router)
app.include_router(audit_router.router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
