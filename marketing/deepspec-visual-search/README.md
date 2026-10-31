# DeepSpec intro and real app entry

A static intro with the chosen white vector identity, blue-glass entry handoff, downward scan animation and small material interactions. The shared Sites page is public.

Every entry button opens the same deployment's `/auth` route. The intro appears before the existing login; camera/upload, saved scans, results, inspections, exports, shop and chat remain in the authenticated application. Existing guest-preview records stay separate and are never silently imported into an account.

The intro phone illustrates an authored review. Actual user images are sent to the real identify endpoint; no example answer is injected into the app. Hosted AI analysis requires provider configuration in the serverless deployment environment. Local desktop configuration is not synchronized by Git. See the repair evidence and deployment checklist for the current verification scope.

## Run and update

Run `python -m http.server 8765 --directory dist`. After editing static resources, run `python package-static.py` and commit canonical and fingerprinted files together. White remains primary; all logo artwork stays static. See `SOURCES.md` and `brand-assets.md`.

The full app’s `scripts/package-intro.mjs` packages this tracked design into `public/intro` and verifies its same-origin `/auth` entry links.

No credentials, Sites project identity or local QA artifacts are included in this export.
