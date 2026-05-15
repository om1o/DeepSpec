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

### `ERR_CONNECTION_REFUSED` when you tap Identify

That means the browser hit `/api/ai` but **nothing listened on port 8788**. Common causes:

| What you ran | Fix |
|---|---|
| Only `vite` / `npm run dev:web` | Start both: from repo root use **`npm run web`**. |
| `vite preview` only | Run **`npm run preview:with-api -w deep-spec`** from repo root *or* run **`npm run dev:api -w deep-spec`** in a second terminal. |

### Deploy on Vercel (previews / production SPA + `/api`)

1. In Vercel → Project → **Root Directory**: `apps/deep-spec`.
2. Build: **`npm run build`**, Output: **`dist`** (framework **Vite** / static).
3. **Environment variables**: add **`GEMINI_API_KEY`** (same as local `.env`).
4. The repo includes **`vercel.json`**: SPA deep links fallback to `index.html`; **`api/ai.ts`** is serverless Gemini using the shared **`server/invoke-ai.ts`** logic as local Express.

**Architecture (short):** The React app never sees the Gemini key—it only **`fetch`es `/api/ai`**. `runAI()` in `src/services/aiService.ts` is still the single client choke point. Locally, Express mounts that path and Vite proxies it; on Vercel, `api/ai.ts` calls the same `invokeAiPost()`. Near-term backlog: migrate off `localStorage` (Supabase/Postgres), add auth/session, rate-limit & abuse protections, observability/alerts on the API route, upload size limits tuning for big photos.
## Mobile shell (`apps/mobile`)

```bash
npm install
npm run mobile
```

Point `apps/mobile/.env` / API base at whatever backend you expose (prototype API on `localhost:8000` if needed; use LAN IP on device testing).

## Schemas

Shared JSON Schema lives in [`packages/schemas`](packages/schemas).
