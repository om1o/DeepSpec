# Deep Spec

Mobile-first PWA scanner for identifying car parts. The current build covers scanning, AI identification, trust checks, saved scan records, and follow-up chat through server-side Gemini proxies.

## Run locally

```bash
npm install
npm run dev
```

Open the URL from Vite. For real iPhone camera and motion testing, use an HTTPS URL. A Vercel preview is the preferred path; a temporary HTTPS tunnel can work for quick testing.

For AI identification, create `.env` or `.env.local` with:

```bash
GEMINI_API_KEY=your_server_key_here
GEMINI_MODEL=gemini-2.5-pro
GEMINI_CHAT_MODEL=gemini-2.5-flash
```

Do not use a `VITE_` API key. The app calls `/api/identify` and `/api/chat`, and the server-side proxies send the key to Gemini.

## Current scope

- Fullscreen rear-camera scanner
- Motion permission prompt for iOS
- Yellow reticle and Identify button after the phone is steady
- Capture and compress the current frame
- Gemini-backed result screen through `/api/identify`
- Model-backed scan category saved on every AI result, with deterministic fallback for old scans and user corrections
- Saved scan database in localStorage with photo, AI result/error, category, training label, rating, correction, notes, and chat history
- Follow-up chat attached to each saved scan through `/api/chat`

Pricing, account sync, and settings are not included yet.

Every scan should be treated as future model-training/evaluation data. LocalStorage is the Phase 4 storage layer, capped at 50 saved scans and validated on read. It is not a secure cloud database; Supabase should preserve the same fields later with auth, row-level security, storage bucket policies, and parent-reviewed privacy terms.

## Test before moving on

```bash
npm run check
```

This runs lint, automated tests, and the production build. Use it before starting the next phase.

## SEO and AI discovery

The app includes search metadata, JSON-LD, `robots.txt`, `sitemap.xml`, `llms.txt`, and useful article pages:

- `/articles/ai-car-part-finding.html`
- `/articles/ai-car-parts-scanner.html`
- `/articles/car-damage-ai-scanner.html`
- `/articles/visual-ai-inspection-tools.html`

Each article also has a `.md` version for AI-readable discovery.

Before launch, replace `https://deepspec.app` in SEO files with the real production domain. Buying or connecting a domain needs parent help.
