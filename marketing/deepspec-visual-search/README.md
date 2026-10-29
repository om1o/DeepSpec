# DeepSpec intro and real app entry

A static intro with the chosen white vector identity, blue-glass entry handoff, downward scan animation and small material interactions. The shared Sites page is public.

Every entry button opens the actual GitHub app’s `/scan` route without email/code sign-in in the explicit preview. There is no preset sample application. The existing camera/upload, saved scans, result, inspection, export, shop and chat code uses a separate browser-local workspace. Account cloud records and normal production access remain separate.

Stable full-app URL: https://deepspec-git-codex-v1-brand-motion-refresh-deep-spec-team.vercel.app

The intro phone illustrates an authored review. Actual user images are sent to the real identify endpoint; no example answer is injected into the app. The current Vercel Preview still needs its server `GEMINI_API_KEY` for live AI analysis. Quota verification works, and uploaded photos persist locally if analysis is unavailable.

## Run and update

Run `python -m http.server 8765 --directory dist`. After editing static resources, run `python package-static.py` and commit canonical and fingerprinted files together. White remains primary; all logo artwork stays static. See `SOURCES.md` and `brand-assets.md`.

The full app’s `scripts/package-intro.mjs` packages this tracked design into `public/intro` and converts its entry links to same-origin `/scan`.

No credentials, Sites project identity or local QA artifacts are included in this export.
