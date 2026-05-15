# DeepSpec Pro (greenfield)

Repo: [github.com/om1o/DeepSpec](https://github.com/om1o/DeepSpec)

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

## Deep Spec (consumer web app — React/Vite/Tailwind)

Runs a **tiny local API** that holds `GEMINI_API_KEY`, so keys never bundle into the browser. From repo root:

```bash
npm install
copy apps\deep-spec\.env.example apps\deep-spec\.env
# Paste your Google AI Studio key into GEMINI_API_KEY
npm run web
```

Opens Vite (~5173) with `/api/*` proxied to the Gemini proxy on localhost `8788` by default.

## Mobile shell (`apps/mobile`)

```bash
npm install
npm run mobile
```

Point `apps/mobile/.env` / API base at whatever backend you expose (prototype API on `localhost:8000` if needed; use LAN IP on device testing).

## Schemas

Shared JSON Schema lives in [`packages/schemas`](packages/schemas).
