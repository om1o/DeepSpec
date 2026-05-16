# Deep Spec

Mobile-first PWA scanner for identifying car parts. The current build covers the scanner plus Phase 2 AI identification through a server-side Gemini proxy.

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
```

Do not use a `VITE_` API key. The app calls `/api/identify`, and the server-side proxy sends the key to Gemini.

## Current scope

- Fullscreen rear-camera scanner
- Motion permission prompt for iOS
- Yellow reticle and Identify button after the phone is steady
- Capture and compress the current frame
- Gemini-backed result screen through `/api/identify`

History, ratings, chat, pricing, and settings are not included yet.

## Test before moving on

```bash
npm run check
```

This runs lint, automated tests, and the production build. Use it before starting the next phase.

## SEO and AI discovery

The app includes search metadata, `robots.txt`, `sitemap.xml`, `llms.txt`, and an article at `/articles/ai-car-part-finding.html`.

Before launch, replace `https://deepspec.app` in SEO files with the real production domain. Buying or connecting a domain needs parent help.
