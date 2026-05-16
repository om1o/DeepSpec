# Deep Spec

Mobile-first PWA scanner for identifying car parts. Phase 1 is intentionally narrow: live rear-camera scanning, a motion-aware reticle, frame capture, and a placeholder result screen.

## Run locally

```bash
npm install
npm run dev
```

Open the URL from Vite. For real iPhone camera and motion testing, use an HTTPS URL. A Vercel preview is the preferred path; a temporary HTTPS tunnel can work for quick testing.

## Phase 1 scope

- Fullscreen rear-camera scanner
- Motion permission prompt for iOS
- Yellow reticle and Identify button after the phone is steady
- Capture and compress the current frame
- Placeholder result screen

No AI, history, ratings, chat, pricing, or settings are included in this phase.

## Test before moving on

```bash
npm run check
```

This runs lint, automated tests, and the production build. Use it before starting the next phase.

## SEO and AI discovery

The app includes search metadata, `robots.txt`, `sitemap.xml`, `llms.txt`, and an article at `/articles/ai-car-part-finding.html`.

Before launch, replace `https://deepspec.app` in SEO files with the real production domain. Buying or connecting a domain needs parent help.
