# DeepSpec Pro (greenfield)

Citation-first technical verification prototype: OCR/barcode fusion, archived manuals, BM25-grounded extraction with mandatory citations, composite verification scoring, and human-in-the-loop gates for high-risk fields.

## Prerequisites

- Docker Desktop (for Postgres + MinIO)
- Python 3.11+ (on Windows use `py -3` if `python` points at the wrong interpreter)
- Node 20+ (`npm` workspaces)

## Quick start — API

```bash
cd c:\Users\omiol\deepspec
docker compose up -d
cd services\api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
py -3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs: http://localhost:8000/docs

## Web admin (Source HUD)

From repo root:

```bash
npm install
npm run web
```

## Mobile shell

```bash
npm install
npm run mobile
```

Point `apps/mobile/.env` / web-admin proxy at `http://localhost:8000` (use machine LAN IP for device testing).

## Schemas

Shared JSON Schema lives in [`packages/schemas`](packages/schemas).
