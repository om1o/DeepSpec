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
GEMINI_MODEL=gemini-2.5-pro
GEMINI_CHAT_MODEL=gemini-2.5-flash
```

Do not use a `VITE_` API key. The app calls `/api/identify` and `/api/chat`, and the server-side proxies send the key to Gemini.

Optional cloud sync uses Supabase. This needs parent-approved privacy terms before real users upload photos:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
```

Never put a Supabase service-role key in a `VITE_` variable. Browser code can only use the publishable/anon key. Apply the migration in `supabase/migrations/20260518000100_deepspec_secure_foundation.sql`, enable Supabase anonymous sign-ins if you want device-only users to sync scans, and keep the `scan-images` bucket private.

For email sign-in, configure the Supabase Auth email template to show the OTP token with `{{ .Token }}` instead of a setup or magic-link URL with `{{ .ConfirmationURL }}`. The app sends an email OTP request and verifies the typed code in the UI; it does not request an email redirect link for code sign-in.

After a session is verified, Deep Spec opens the scanner at `/scan`.

### QA test scan (no save)

Use this to run a bundled engine photo through the fixed QA result without writing history, session cache, provider quota, or cloud sync:

```
http://localhost:5173/scan?test=1
```

Tap **Test engine photo** on the yellow panel. It does not require `GEMINI_API_KEY`; it only requires `npm run dev`.

### Local dataset matching

After downloading `DrBimmer/car-parts-and-damage-dataset` into `datasets/raw/drbimmer-car-parts-and-damage-dataset`, build the local labeled index with:

```bash
npm run dataset:sort
```

The command writes ignored local files under `datasets/derived/drbimmer-car-parts-and-damage-dataset`, including `records.jsonl`, per-label indexes, and sorted image links. `/api/identify` reads that index after Gemini responds, adds matching local dataset evidence, and surfaces direct Hugging Face source links on the result screen.

Google sign-in is hidden by default because it depends on a live Google OAuth client configured in the Supabase Google provider. Only enable it after the Google client ID and secret are valid:

```bash
VITE_ENABLE_GOOGLE_AUTH=true
```

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

Every scan should be treated as future model-training/evaluation data. LocalStorage is the default storage layer, capped at 300 saved scans and validated on read. Supabase sync is optional and preserves the same dataset fields with auth ownership, row-level security, a private storage bucket, and explicit grants for browser-safe access.

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

## SEO and AI discovery

The app includes search metadata, JSON-LD, `robots.txt`, `sitemap.xml`, `llms.txt`, and useful article pages:

- `/articles/ai-car-part-finding.html`
- `/articles/ai-car-parts-scanner.html`
- `/articles/car-damage-ai-scanner.html`
- `/articles/visual-ai-inspection-tools.html`

Each article also has a `.md` version for AI-readable discovery.

Before launch, replace `https://deepspec.app` in SEO files with the real production domain. Buying or connecting a domain needs parent help.
