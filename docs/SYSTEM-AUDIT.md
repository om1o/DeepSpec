# DeepSpec — Full System Audit (how everything ticks)

Audit date: 2026-06-29. Scope: the entire app — isolation/separation, the AI model tools, the
result/answer UI, auth, billing, cloud sync, storage, shop, chat, metrics, datasets, eval, QA, PWA.
Verdict markers used below: ✅ works · 🟡 works-but-gated/partial · 🔴 doesn't work without config · ⚰️ dead code.

---

## 0. What DeepSpec is + the stack

A mobile-first PWA that identifies vehicle parts (and damage) from a phone photo, isolates the part visually,
and explains it in plain language. Stack: **Vite + React 19 + TypeScript + Tailwind v4**, **Supabase**
(auth + Postgres + storage), **@huggingface/transformers** (in-browser ML), **react-webcam**, serverless
**`/api/*`** handlers, billing via **Polar or Stripe**. Tests: **Vitest (458 passing / 56 files)**; build is clean.

High-level flow: **camera → heuristic target → crop → in-browser background removal → cloud AI identify →
positive answer card + isolated AR view**, persisted locally and (optionally) synced to Supabase.

---

## 1. THE ISOLATION & SEPARATION PIPELINE (the core)

This is the part you care most about. It runs in two phases: a lightweight **live** phase (the reticle while you
aim) and a heavier **post-capture** phase (the real isolation after you tap scan).

### 1a. Capture resolution
- `src/hooks/useCamera.ts` → `captureFrame()` compresses every shot to **`CAPTURE_MAX_EDGE = 2048`px** longest
  edge at JPEG quality 0.85 (`src/lib/utils.ts`).
- Camera is requested at **ideal 2560×1440** (`DEFAULT_VIDEO_CONSTRAINTS`, `Scanner.tsx`); cameras negotiate down.
- Gallery uploads over 1 MB are also compressed to 2048px.
- (History: this used to be 1024px — that cap was the reason cutouts looked soft; it was raised to ~2K.)

### 1b. Live targeting (the reticle) — heuristic, NO ML  ✅
- `src/hooks/useObjectTarget.ts` samples the video every **180 ms** at a **128px** long edge.
- `src/lib/objectTargeting.ts` `detectObjectTargetFromImageData()` builds a **24×18 saliency grid** scoring
  **texture (55%) + edges (35%) + color (10%)**, groups hot cells into a component, scores by size+center+saliency,
  and returns a normalized box (min confidence 0.22). **No neural net** — pure image stats.
- `src/lib/scannerReticle.ts` defines the reticle (≈72% width / 52% height of viewport); a target must sit inside
  it and be held **1500 ms** to "lock". `src/hooks/useStillness.ts` uses device motion to require a steady hold.

### 1c. Post-capture separation — `Scanner.tsx` → `analyzeImageBase64()` (~line 299)  ✅
Order of operations:
1. **Still target**: `getReviewTargetFromCapturedImage()` re-runs the heuristic detector on the full-res still.
2. **Quality gate**: `assessImageQuality()` (`src/lib/imageQuality.ts`, heuristic — brightness/sharpness/glare/size).
   Fails → a "quality coach" nudge, scan stops.
3. **Crop**: if a target exists, `src/lib/focusCrop.ts` `createFocusedScanCrop()` crops to it with **6% padding**
   (min 48px) → a tighter, higher-res crop.
4. **Quality-gate the crop**, then **segment** it.
5. **Segmentation** (`src/lib/productSegmentation.ts` `createSegmentedProductIsolation()`):
   - Model: **`onnx-community/MVANet-ONNX`** (background-removal / matting) via the Transformers.js
     `pipeline("background-removal", …)`, dtype **fp32**.
   - Gated by env **`VITE_DEEPSPEC_SEGMENTATION`** (default ON; override model with
     `VITE_DEEPSPEC_SEGMENTATION_MODEL`). Two **6.5 s** timeouts (model load + inference).
   - Produces a transparent-alpha PNG of the part + an **alpha bounding box** (`focusBox`).
   - **Crisp-cutout compositing**: because the model output is low-res, the code paints the model's **alpha mask
     over the native ~2K crop** on a canvas (`destination-in`), exporting a full-resolution cutout (falls back to
     the model image on any failure). This is what makes the isolated part look sharp.
6. **focusMode** is set: **`"mask"`** when segmentation succeeded (with `focusBox` remapped to full-frame space via
   `mapCropFocusBoxToScanBox`), **`"crop"`** when only the crop exists, **`"full_frame"`** when no target.
7. **Cache** check (`scanCache.ts`, image hash), then **cloud identify** (section 2), then `persistAndShowReview`
   stores `{ frame, result, focusBox, focusMode, isolatedImageBase64, sceneObjects }`.

### 1d. The AR display — `src/components/result/IsolatedPartView.tsx`  ✅
A single shared component used by both the in-scanner review and the saved Result page. Three render tiers:
- **Tier A — true isolation** (`focusMode==="mask"` + cutout present): the real transparent cutout, **sharp**,
  positioned by `focusBox` over the **blurred + dimmed** full frame.
- **Tier B — focused crop** (`"crop"`, or mask without a cutout): a **sharp clip-path window** of the same frame,
  pixel-aligned over the blur. Never the old four-rectangle hole.
- **Tier C — full frame** (`"full_frame"` / no box; also old & cloud-reopened scans): the full frame, sharp.
- **Issue pointer**: when the AI reports visible damage, exactly one calm callout points at the damaged region
  (`deriveIssue` + `regionLabelToBox` maps a coarse "upper left/center/…" to a 3×3 cell).
- **Smart background for busy scenes** (multiple `sceneObjects`): instead of the hard single-part blur, the
  background is only **gently faded** (brightness/saturate, no heavy blur) so the other items stay visible, and a
  small label chip is drawn over each secondary object where it sits (capped at 4).

### 1e. Multi-object "categorize all of them" (scene objects)  ✅ (cloud-only)
- The cloud AI returns an optional **`sceneObjects: { name, category, regionLabel, primary }[]`** listing every
  distinct visible object (the part **and** background items like posters/tools).
- Threaded end-to-end: prompt (`systemPrompts.ts` + `api/identify.shared.ts`) → tolerant parse/validate
  (`coerceSceneObjects` / `isSceneObjectArray`) → local normalize (`storage.ts`) → cloud round-trip
  (`cloudHistory.ts` `parseSceneObjects`).
- UI: on-image chips (above) + a compact **"Also in view"** category list in the card (`PositiveAnswerCard.tsx`).
- ⚠️ Populated **only by the cloud AI**. Offline/on-device scans leave it empty → no chips/categories offline.

### Isolation: what DOESN'T work / limits
- 🟡 **Not synced to cloud:** `isolatedImageBase64`, `focusBox`, `focusMode` are saved **locally only**
  (`storage.ts`). Same-device History reopen shows the cutout; a scan reopened on a **different device / from the
  cloud** has no cutout → it degrades to **Tier C (full frame)**. Closing this needs uploading the cutout to a
  storage path + adding `focus_box`/`focus_mode` columns (a Supabase migration). (sceneObjects *do* sync — they
  ride inside `result_json`.)
- 🟡 **Segmentation can time out** on slow phones (6.5 s) or be disabled by env → falls back to Tier B/C.
- 🟡 **Targeting is heuristic** (no ML); it can mis-pick in cluttered scenes. The cloud `sceneObjects` layer is the
  compensation for that.
- By design: isolation runs **after capture**, not live; the crisp-cutout composite runs only at scan time
  (not unit-tested, but has a fallback).

---

## 2. THE AI IDENTIFY PIPELINE (cloud + on-device)

Entry: client `src/services/aiService.ts` `identifyCapturedFrame()` → POST `/api/identify` →
`api/identify.shared.ts` `createIdentifyResponse()`. **Multi-provider with hedging, rescue, and OCR.**

### Provider order & "model tools"  ✅ (Gemini required for full quality)
Effective order in `createIdentifyResponse()`:
1. **Groq** *first* if its fallback is explicitly enabled (rate-limit-retry wrapped).
2. **Gemini** (primary) with **model hedging** — starts `gemini-2.5-flash`, and after a **4 s** delay also starts
   `gemini-2.5-flash-lite`; first 200 wins.
3. **Groq retry**, then **Hugging Face router**, then **Ollama** as further fallbacks.
4. **On-device CLIP** — never called from the server; the *browser* uses it when offline / provider unavailable.
5. If Gemini fails and no fallback exists → a **compact "rescue" Gemini prompt** (temp 0, 700 tokens, ≤15 s).

| Tool (model) | Role | Endpoint | Key env | Timeout |
|---|---|---|---|---|
| **gemini-2.5-flash** (+ `-flash-lite`) | Primary vision identify | `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | 25 s |
| **meta-llama/llama-4-scout-17b-16e-instruct** (Groq) | Fallback vision identify | `api.groq.com/openai/v1/chat/completions` | `GROQ_API_KEY`, `DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK` | 45 s |
| **Qwen/Qwen2.5-VL-7B-Instruct** (HF router) | Fallback vision identify | `router.huggingface.co/v1/chat/completions` | `HF_TOKEN`/`HF_API_TOKEN`/`HUGGINGFACE_API_KEY`, `DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK` | 45 s |
| **llava:latest** (Ollama) | Local fallback vision identify | `127.0.0.1:11434/api/chat` | `DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK`, `OLLAMA_BASE_URL` | 180 s |
| **Xenova/clip-vit-base-patch32** | On-device zero-shot classify (offline) | in-browser (WebGPU/WASM, q4) | `VITE_ENABLE_ON_DEVICE_FALLBACK` | 90 s |
| **microsoft/trocr-large-printed** | OCR label rescue | `api-inference.huggingface.co/models/microsoft/trocr-large-printed` | `HF_TOKEN`/`HUGGINGFACE_API_KEY` | 12 s |
| **onnx-community/MVANet-ONNX** | Background removal / isolation | in-browser (Transformers.js) | `VITE_DEEPSPEC_SEGMENTATION` | 6.5 s |
| objectTargeting.ts (heuristic) | Live target / reticle | in-browser, no ML | — | per-frame |
| imageQuality.ts (heuristic) | Quality gate | in-browser, no ML | — | per-frame |

Gemini generation config: `temperature 0.1`, `maxOutputTokens 2048`, `responseMimeType application/json`,
`thinkingBudget 0` (configurable). HF/Groq: OpenAI-style `response_format: json_object`, temp 0.1.
Retryable statuses: `408/429/500/502/503/504`; backup providers retry once on 429 with 800 ms backoff.

### OCR  ✅
Runs when the client sends `labelRescueTrigger:"too_blurry"` OR the user message mentions label/part-number/serial/
barcode/etc. TrOCR text is cleaned (≤160 chars) and injected as "OCR label text:" evidence into every provider path.

### On-device fallback  ✅ (optional)
`src/services/onDeviceIdentify.ts`: CLIP zero-shot over a **32-label automotive set** (fenders, bumpers, lights,
brakes, radiator, engine…). Always returns `confidence:"low"`, `provider:"on-device"`. Triggers when
`navigator.onLine===false` (and flag on) or after a cloud `provider_unavailable` error (90 s cap). First run
downloads ~150–250 MB (cached). `offlineUpgrade.ts` re-runs these through the cloud when you reconnect.

### Result schema (what the model returns)
`IdentificationResult` (`src/types/index.ts`): `partName`, `confidence` + `confidenceScore`/`confidenceRange`,
`scanCategory` (engine/electrical/brakes/steering/suspension/fuel/airbag/body/leak/unknown), `whatItDoes`,
`visibleObservations`, `evidenceRegions`, **`sceneObjects`**, `concerns`, `candidateMatches`/`candidateParts`,
`measurements`, `safetyTriage`, `isSafetyCritical`, `nextAction`, `needsBetterPhoto`, `sourceLinks`, `modelRun`.
Error codes: `rate_limited`, `network`, `provider_error`, `invalid_response`, `not_configured`,
`image_too_large`, `invalid_input`.

### Identify: what DOESN'T work / limits
- 🔴 Needs **`GEMINI_API_KEY`** (or an enabled fallback). With none configured, identify returns `not_configured`
  (the scanner UI still runs; you just can't identify) — unless on-device is enabled and you're offline.
- 🟡 Ollama path is dev-only (needs a local server; URL is validated but liveness isn't).
- 🟡 Behavior is entirely env-driven → misconfiguration causes silent quality loss (no OCR, no hedging, etc.).

---

## 3. THE ANSWER / RESULT UI  ✅
- `src/lib/simpleResultSummary.ts` → positive `{ eyebrow, title, body, nextAction }` (strips "Likely", detects
  damage words, names non-parts plainly). No confidence %, no orange. `src/lib/resultFacts.ts` builds the detail
  facts, the issue, and the scene chips.
- `src/components/result/PositiveAnswerCard.tsx` exports `IssueLine`, `ResultDetailSections` (scroll-for-detail:
  what we see / match clues / flags / next step), and `SceneCategoryList` ("Also in view").
- Shown in **Scanner.tsx** (in-scanner review bottom sheet) and **Result.tsx** (saved page) — both pair the card
  with `IsolatedPartView`. ⚰️ The old `src/components/scanner/FocusedPartOverlay.tsx` is **orphaned/dead** (safe to delete).

---

## 4. AUTH  🔴-if-unconfigured
`src/services/auth.ts` (Supabase). Methods: **email OTP (magic link/code), email+password, anonymous, and optional
Google/GitHub OAuth** (`VITE_ENABLE_GOOGLE_AUTH` / `VITE_ENABLE_GITHUB_AUTH`). Session persists; verified-user cache
30 s, verify timeout 8 s. `RequireAuth` in `App.tsx` guards everything except `/auth`.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- ⚠️ **No local-only mode**: if Supabase isn't configured, *all* routes (including scanning) are blocked behind the
  guard and the auth UI shows "not configured." This is the single biggest "doesn't work without setup" gap.

## 5. BILLING / PAYMENTS  🟡 sandbox/testing-only by design
`api/billing.shared.ts` + `billing-checkout/portal/webhook.ts`, `src/services/revenue.ts`, `Pricing.tsx`,
`Account.tsx`. **Dual provider: Polar (default, sandbox) or Stripe**, selected by `BILLING_PROVIDER`.
- Plans: `plus_monthly` $9.99/100 scans, `plus_yearly` $59/1200, `scan_pack` $4.99/20, `pro_beta` $49/500.
- Entitlements in Supabase table `billing_entitlements` (RLS: user can read own row; **writes are webhook/service-
  role only**). Endpoint `GET /api/account-entitlement` (Bearer token). Free tier = 5 scans, counted locally.
- **Live payments are blocked** unless `DEEPSPEC_ENABLE_LIVE_BILLING="true"` AND live keys/env are set
  (`blockLiveBillingUnlessEnabled`). Scan-credit enforcement is opt-in via `DEEPSPEC_ENFORCE_SCAN_CREDITS="true"`.
- Pricing UI literally says "Sandbox only" / "Start sandbox checkout". Code is complete; it's gated, not stubbed.
- Server writes need `SUPABASE_SERVICE_ROLE_KEY` (+ `SUPABASE_URL`).

## 6. CLOUD SYNC + LOCAL STORAGE  ✅ (when configured)
- **Local** (`src/services/storage.ts`): `deep-spec:lookups` (cap **50** scans, oldest evicted),
  per-scan chat `deep-spec:chat:{id}` (cap 40). The `Lookup` carries result + focusBox/focusMode/isolatedImageBase64
  + ratings/correction/notes + shop fields. Quota errors handled gracefully.
- **Cloud** (`cloudSync.ts` / `cloudHistory.ts`): table `scan_lookups` (+ detail tables `scan_candidates`,
  `scan_evidence`, `scan_corrections`, `scan_model_runs`, `sync_events`, `job_scans`), images in the **`scan-images`**
  bucket at `{user_id}/{lookup_id}.{ext}`, signed URLs valid **60 min**. RLS isolates users; a `verifyCloudHealth()`
  routine tests upload + row + RLS isolation end-to-end.
- **Synced:** frame image, `result_json` (incl. `sceneObjects`), rating/correction/notes, metadata, chat, shop context.
- **NOT synced:** `isolatedImageBase64`, `focusBox`, `focusMode` (local-only — see §1e limit). Cloud history loads
  **core columns only**; shop-optional columns live inside `result_json`/metadata.

## 7. SHOP / JOBS  ✅ (local-first, single-org)
`Shop.tsx` / `ShopJob.tsx` / `ShopNewJob.tsx` + `src/services/shop.ts`. Technician job queue with VIN/RO/customer/
symptom search, KPI tiles (open jobs, scans, useful rate, correction rate), job intake, vehicle context, status
flow (open→in_progress→ready_for_review→closed), `attachScanToJob`, and a customer report export. Stored locally
(`deep-spec:shop:jobs`, cap 200; default org `00000000-0000-4000-8000-000000000001`). Cloud columns exist
(`job_id`, `org_id`, `technician_user_id`, `vehicle_context`, `review_status`). 🟡 Multi-org/permissions is a
framework around a single default local org.

## 8. CHAT + REPORTS  ✅
- `Chat.tsx` at `/result/:id/chat`: needs a saved scan with a result; questions (≤500 chars) persist in
  `lookup.chatHistory`; `sendFollowUp` → POST `/api/chat` → `api/chat.shared.ts` → Gemini (**gemini-2.5-flash**,
  temp 0.3, 480 tokens, 20 s server / 30 s client, `FOLLOWUP_PROMPT`). Same model-fallback list as identify.
- `report.ts`: `buildScanReport` (60+ line text report), `getScanReportFilename`, `downloadTextFile`; Result.tsx
  share/export uses `navigator.share()` or download.

## 9. METRICS / TRAINING-READINESS / DATASETS / EVAL  ✅ (local + offline tooling)
- `scanQualityMetrics.ts`: **local-only** counters (attempts, acceptable, first-pass, failures/retakes by reason,
  per-camera needs-better, identify latency, corrections, 1–5 trust scores) under `deep-spec:scan-quality-metrics`.
  **No telemetry/backend** — purely on-device.
- `trainingReadiness.ts`: computes a 0–90 readiness score + label per scan for UI badges; privacy note "not used
  for training unless sharing is allowed." Local-only.
- `datasets/`: DrBimmer car-parts-&-damage dataset (1,812 images, indexed to `records.jsonl`), MIT licensed.
- `scripts/eval-identify.mjs`: scores the identify pipeline against dataset samples (release gate = 50 images,
  public = 300), with rate-limit backoff, per-label pass/fail buckets, safety-false-positive detection, and exit
  codes; artifacts to `.deepspec-eval/`. Verified by `verify-identify-eval-summary.mjs`. Dataset build scripts:
  `dataset:sort`, `dataset:hf-auto-sources`, `dataset:source-manifest`, `dataset:verified-sources`.

## 10. QA TOOLING  ✅
`scripts/qa/*` (14 scripts). `npm run test:website` runs `qa-doctor` (env/auth/browser/network/selectors) then
`real-website-tester.mjs` (Playwright over **28 scenarios** — auth, scanner, scanner-ai-engine, history, result,
chat, pricing/checkout/entitlements, shop flows, billing fail-closed). Artifacts (screenshots/html/video/trace/
`qa-summary.md`) to `artifacts/qa/<timestamp>/`. Also `web-ar-tester`, `external-ar-tester`, `phone-*`,
`user-impact`. Safety rules: no real payments, no data deletion, no destructive git.

## 11. PWA / BUILD / ROUTING  ✅
`vite.config.ts` + `vite-plugin-pwa` (autoUpdate SW, manifest "Deep Spec", standalone/portrait, precache JS/CSS/
img; the ~540 KB transformers chunk is excluded and loads on demand). `/api/*` handlers run in dev/serverless;
preview returns 501. `App.tsx`: `RequireAuth` guard, lazy-loaded Scanner (chunk warmed at boot), 404→`/`.
`main.tsx` warms the Supabase client and starts the offline-upgrade watcher.

---

## 12. CONSOLIDATED: WHAT WORKS vs WHAT DOESN'T

**Works end-to-end ✅**
- The full isolation pipeline (2K capture → heuristic target → crop → MVANet removal → crisp composite → A/B/C
  display + issue pointer + scene chips). Degrades gracefully on timeout/disable.
- Multi-provider identify (Gemini hedged + Groq/HF/Ollama fallbacks + rescue + OCR + on-device offline).
- Positive, scrollable answer card with "Also in view" categories.
- Local storage, chat, text reports, shop jobs (local), eval + QA tooling, PWA/offline, cloud sync + RLS (configured).
- 458 tests pass; lint clean; production build OK.

**Gated / partial 🟡**
- Billing is **sandbox/testing-only** until `DEEPSPEC_ENABLE_LIVE_BILLING=true` + live keys.
- Shop is single-default-org locally; multi-org/permissions is a thin framework.
- `sceneObjects` is **cloud-only** (empty offline).
- Cloud history loads core columns only; signed image URLs expire after 60 min.

**Doesn't work without configuration 🔴**
- **No Supabase → no app**: every route (even scanning) is auth-guarded; there is no local-only/guest mode.
- **No `GEMINI_API_KEY` (or fallback) → no identify** (`not_configured`); scanner UI still runs.
- `/api/account-entitlement` needs `SUPABASE_SERVICE_ROLE_KEY`.

**Cross-device isolation gap 🟡 (the main isolation TODO)**
- The isolated cutout + focusBox/focusMode are **local-only**; a scan reopened from the cloud on another device
  loses the cutout and shows the plain full frame. Fix = upload the cutout PNG + add focus columns (a migration).

**Dead code ⚰️**
- `src/components/scanner/FocusedPartOverlay.tsx` — orphaned, not imported anywhere. Safe to delete.
- `src/services/phase8Validation.test.ts` — test-only (validates that the verify scripts/docs exist); fine to keep.

---

## 13. ENVIRONMENT VARIABLES (quick reference)
- **Required for the app to function:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (auth/cloud);
  `GEMINI_API_KEY` (identify); `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL` (entitlement/webhook writes).
- **AI fallbacks (optional):** `DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK` + `GROQ_API_KEY`;
  `DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK` + `HF_TOKEN`; `DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK` + `OLLAMA_BASE_URL`;
  `VITE_ENABLE_ON_DEVICE_FALLBACK`. Tunables: `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`,
  `DEEPSPEC_GEMINI_IDENTIFY_HEDGE_DELAY_MS` (4000), `DEEPSPEC_IDENTIFY_PROVIDER_TIMEOUT_MS` (25000),
  `DEEPSPEC_GEMINI_IDENTIFY_THINKING_BUDGET` (0).
- **Isolation:** `VITE_DEEPSPEC_SEGMENTATION` (on), `VITE_DEEPSPEC_SEGMENTATION_MODEL` (onnx-community/MVANet-ONNX).
- **OAuth (optional):** `VITE_ENABLE_GOOGLE_AUTH`, `VITE_ENABLE_GITHUB_AUTH`.
- **Billing (optional/gated):** `BILLING_PROVIDER` (polar|stripe), `DEEPSPEC_ENABLE_LIVE_BILLING`,
  `DEEPSPEC_ENFORCE_SCAN_CREDITS`, Polar (`POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_ENVIRONMENT`,
  `POLAR_PRODUCT_DEEPSPEC_*`) or Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_DEEPSPEC_*`).
