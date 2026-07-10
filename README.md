# Deep Spec

Mobile-first PWA scanner for identifying car parts. The current build covers scanning, AI identification, trust checks, saved scan records, and follow-up chat through server-side Gemini proxies.

See `docs/PROJECT_GOAL.md` for the Deep Spec engineering, UI, UX, framework, and definition-of-done standard.

## Run locally

```bash
npm install
npm run dev
```

Open the URL from Vite. For real iPhone camera and motion testing, use an HTTPS URL. A Vercel preview is the preferred path; a temporary HTTPS tunnel can work for quick testing.

For AI identification, create `.env` or `.env.local` with:

```bash
GEMINI_API_KEY=your_server_key_here
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite
GEMINI_CHAT_MODEL=gemini-2.5-flash
GEMINI_CHAT_FALLBACK_MODELS=gemini-2.5-flash-lite
```

Do not use a `VITE_` API key. The app calls `/api/identify` and `/api/chat`, and the server-side proxies send the key to Gemini.

For emergency local development when Gemini is rate-limited, `/api/identify` can fall back to a local Ollama vision model after all configured Gemini identify models fail with provider availability errors:

```bash
ollama pull llava
DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_IDENTIFY_MODEL=llava:latest
```

Keep this off for normal release checks unless the fallback host is intentionally available to the backend. A deployed Vercel function cannot reach Ollama on your laptop at `localhost`.

Optional cloud sync uses Supabase. This needs parent-approved privacy terms before real users upload photos:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
```

Never put a Supabase service-role key in a `VITE_` variable. Browser code can only use the publishable/anon key. Apply the migration in `supabase/migrations/20260518000100_deepspec_secure_foundation.sql`, enable Supabase anonymous sign-ins if you want device-only users to sync scans, and keep the `scan-images` bucket private.

For email sign-in, the app requests a Supabase OTP email with a `/scan` redirect link. The default Supabase template sends a magic link; if you want typed code entry too, configure the email template to show the OTP token with `{{ .Token }}`. Users can also sign in with Supabase email/password credentials or create a password account. If Supabase requires email confirmation, the app waits for confirmation instead of opening the scanner immediately.

After a session is verified, Deep Spec opens the scanner at `/scan`.

### Test the isolation on a phone or iPad (debug overlay)

The scanner tries a few ways to cut the part out of the photo (SAM, then MVANet, then a plain
crop). To see **which one ran and why a cutout looks rough — with no computer and no F12** —
turn on the on-screen debug overlay. A kid can follow this:

1. In `.env.local`, add one line and restart the app:

   ```bash
   VITE_DEEPSPEC_DEBUG=on
   ```

2. Open the app's **HTTPS** URL on the phone or iPad (the camera only works over HTTPS — use the Vercel/preview link).
3. Scan something (a game controller in your hand is a good test).
4. A small **DEBUG · isolation** box shows up in the top-left corner with:
   - **WebGPU** — `yes` / `no` (does this device have the fast graphics path SAM needs?)
   - **Segmenter** — `SAM`, `MVANet`, `crop`, or `full frame` (which cutter actually ran)
   - **focusMode** — `mask`, `crop`, or `full_frame`
   - **SAM load** / **SAM inference** — milliseconds SAM took
   - **SAM ok** — `yes` if SAM made a cutout
   - **SAM error** — a message if SAM couldn't load
5. Tap **Copy diagnostics**.
6. Paste it into a message and send it back (a screenshot helps too).

What the readout means:
- **WebGPU: no** → this device can't run SAM in the browser; it falls back to MVANet (the hand may stay). No stall.
- **WebGPU: yes · SAM ok: yes · small inference ms** → SAM is working. 🎉
- **WebGPU: yes · SAM error / SAM ok: no** → send the error line; we tweak the model or move SAM to the server.

Turn it off by deleting the `VITE_DEEPSPEC_DEBUG` line (or setting it to `off`).

### Local dataset matching

After downloading `DrBimmer/car-parts-and-damage-dataset` into `datasets/raw/drbimmer-car-parts-and-damage-dataset`, build the local labeled index with:

```bash
npm run dataset:sort
```

The command writes ignored local files under `datasets/derived/drbimmer-car-parts-and-damage-dataset`, including `records.jsonl`, per-label indexes, and sorted image links. `/api/identify` reads that index after Gemini responds, adds matching local dataset evidence, and surfaces direct Hugging Face source links on the result screen.

For release gating, run the fixed 50-case identify eval:

```bash
npm run eval:identify:release
```

The eval reads `DEEPSPEC_DATASET_ROOT` locally first, falls back to Hugging Face if a sample is missing, and records latency, invalid response rate, safety false-positive rate, and provider availability in `.deepspec-eval/identify-summary.json`.

If Gemini is rate-limited or unavailable, run `npm run eval:identify:provider-health` first and use `docs/AI_PROVIDER_FALLBACK_PLAN.md` before adding or enabling any backup provider.

For a broader benchmark built from the sorted local dataset index, run:

```bash
npm run eval:identify -- --sample-set public --sample-size 300
```

The public sample mode uses `DEEPSPEC_DATASET_INDEX_PATH` and will spend live provider quota for every attempted image.

Before release browser QA, use `docs/BROWSER_QA_MATRIX.md` for the route, viewport, console, network, and seeded-scan evidence checklist.

Google and GitHub sign-in are opt-in. Enable a provider in Supabase Auth first, then set the matching flag to `true` so the login page does not show a dead OAuth button:

```bash
VITE_ENABLE_GOOGLE_AUTH=true
VITE_ENABLE_GITHUB_AUTH=true
```

There is no local continue or fixture login path. A protected route opens only after Supabase verifies an email code, password, or OAuth session.

## Current scope

- Fullscreen rear-camera scanner
- Motion permission prompt for iOS
- Fixed lens frame, automatic hold capture, and a low manual Scan shutter
- Capture and compress the current frame
- Gemini-backed result screen through `/api/identify`
- Model-backed scan category saved on every AI result, with deterministic fallback for old scans and user corrections
- Saved scan database in localStorage with photo, AI result/error, category, training label, rating, correction, notes, and chat history
- Follow-up chat attached to each saved scan through `/api/chat`
- Early access page at `/early-access` for waitlist and feedback validation
- Scan report sharing/export from saved scan results
- Nearby repair options CTA for professional-verification cases
- Optional Supabase cloud sync for saved scans, waitlist entries, and feedback

Pricing, account sync, public share links, and settings are not included yet.

Every scan should be treated as future model-training/evaluation data. LocalStorage is the default storage layer, capped at 50 saved scans and validated on read. Supabase sync is optional and preserves the same dataset fields with auth ownership, row-level security, a private storage bucket, and explicit grants for browser-safe access.

Waitlist and feedback entries save locally first, then sync to Supabase only when cloud config exists. A real public launch still needs parent-approved privacy terms.

## Supabase security shape

- `public.scan_lookups`: owned by `auth.uid()`, no anonymous table access, RLS for select/insert/update/delete.
- `storage.scan-images`: private bucket; users can only access files in their own user-id folder.
- `public.waitlist_signups` and `public.feedback_submissions`: public insert only, narrow validation checks, no public read.
- The browser uses Supabase Auth anonymous sign-in for scan sync. That creates a real auth user without building a full account system yet.

To prove a real Supabase project is wired correctly, run:

```bash
npm run verify:supabase
```

That command signs in anonymously, uploads a private test image, writes a scan row, checks cross-user RLS blocking, downloads the owner image, and cleans up. See `docs/PHASE_8_SUPABASE_VALIDATION.md` for the full Phase 8 checklist.

## Test before moving on

```bash
npm run check
```

This runs lint, automated tests, and the production build. Use it before starting the next phase.

Before opening or updating a PR into `main`, also run the browser environment doctor against the real local or preview URL:

```bash
$env:QA_BASE_URL="http://127.0.0.1:5174"; npm run qa:doctor
```

In bash/zsh shells, use `QA_BASE_URL=http://127.0.0.1:5174 npm run qa:doctor`.

If Vite chose another port, replace the URL with the one printed by `npm run dev`. Do not treat browser QA failures as product bugs until `qa:doctor` passes or classifies the blocker.

## SEO and AI discovery

The app includes search metadata, JSON-LD, `robots.txt`, `sitemap.xml`, `llms.txt`, and useful article pages:

- `/articles/ai-car-part-finding.html`
- `/articles/ai-car-parts-scanner.html`
- `/articles/car-damage-ai-scanner.html`
- `/articles/visual-ai-inspection-tools.html`

Each article also has a `.md` version for AI-readable discovery.

Before launch, replace `https://deepspec.app` in SEO files with the real production domain. Buying or connecting a domain needs parent help.
