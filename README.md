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
