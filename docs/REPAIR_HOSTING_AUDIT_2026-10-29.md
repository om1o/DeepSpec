# DeepSpec repair: integration and hosting audit, 2026-10-29

## Executive summary

The existing model integrations remain present. No replacement provider, model download, inference request, credential change, deployment or paid operation was used for this audit. Source inventory establishes execution paths, not live AI readiness.

Inspected PR #124 head: `f9ba5cc3736b3b16fd1836f8ec4b655cb29d2ec3`, newer than the supplied `76c3e9022e0f496f9020598d9e63f67893e823e7`. PR #119 remains at `c1014e73cb4d5405ea377becb6db70bc3a21c266`. The repair branch starts at the newer #124 head. This report describes that source and the retained model paths; the separate repair report records final changes and verification.

The current cloud environment has no configured secret bindings, runtime variables or outbound identities according to its observed-ready environment status. Only `.env.example` exists in this fresh checkout. This says nothing definitive about the secrets in the existing Vercel deployment or on the user's desktop. Desktop parity and deployed credential readiness are **unverified**.

## Actual integrations

The nine default IDs below match `docs/AI_MODEL_PIPELINE.md`. These are conditional tools/providers, not nine simultaneous model calls. Environment overrides can select other model IDs or compatible endpoints.

| Integration and source | Default model | Enablement and actual path |
| --- | --- | --- |
| SlimSAM, `src/lib/promptableSegmentation.ts` | `Xenova/slimsam-77-uniform` | Browser Transformers.js `SamModel.from_pretrained` and `AutoProcessor.from_pretrained`; WebGPU only; defaults on. `VITE_DEEPSPEC_PROMPTABLE_SEG=off/false/0` disables; `VITE_DEEPSPEC_PROMPTABLE_SEG_MODEL` overrides ID; `VITE_DEEPSPEC_PROMPTABLE_SEG_DTYPE` overrides default `q8`. Five positive points per target box; up to four scene objects. |
| MVANet, `src/lib/productSegmentation.ts` | `onnx-community/MVANet-ONNX` | Browser Transformers.js `pipeline("background-removal", ...)`, WebGPU only; defaults on. `VITE_DEEPSPEC_SEGMENTATION=off/false/0` disables; `VITE_DEEPSPEC_SEGMENTATION_MODEL` and `VITE_DEEPSPEC_SEGMENTATION_DTYPE` override ID/default `q8`. Fallback when prompted isolation is unavailable within the visual budget. |
| CLIP estimate, `src/services/onDeviceIdentify.ts` | `Xenova/clip-vit-base-patch32` | Browser Transformers.js zero-shot image classification, `q4`, WebGPU with WASM fallback. Only `VITE_ENABLE_ON_DEVICE_FALLBACK=true` enables. Fixed category labels produce a labelled, limited estimate. It is not general identification or chat. |
| Gemini identify, `server/identify.shared.ts` | `gemini-2.5-flash` | Server `GEMINI_API_KEY`; model override `GEMINI_MODEL`; `GEMINI_FALLBACK_MODELS` supplements defaults. Calls Google `generateContent` with image input, visible-evidence instructions and normalized structured results/provenance. |
| Gemini identify/chat fallback, same file and `server/chat.shared.ts` | `gemini-2.5-flash-lite` | Default appended fallback. Identification can hedge after a default 4 seconds; this is an existing extra-call path requiring deployment cost review. Retry and response parsing remain intact. |
| Groq identify, `server/identify.shared.ts` | `meta-llama/llama-4-scout-17b-16e-instruct` | Both `DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK=true` and `GROQ_API_KEY` are required. Despite the historical flag name, configured Groq runs **before Gemini**. `GROQ_IDENTIFY_MODEL` / `GROQ_IDENTIFY_ENDPOINT_URL` override defaults. OpenAI-compatible vision chat-completions adapter. |
| HF-compatible identify, same file | `Qwen/Qwen2.5-VL-7B-Instruct` | Both `DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK=true` and a token are required; token precedence `HF_TOKEN`, `HF_API_TOKEN`, `HUGGINGFACE_API_KEY`. Default endpoint `https://router.huggingface.co/v1/chat/completions`; `HF_IDENTIFY_MODEL`, `HF_IDENTIFY_ENDPOINT_URL`, `HF_IDENTIFY_PROVIDER` override routing. `DEEPSPEC_FORCE_HF_IDENTIFY=true` is the explicit forced path. OpenRouter works only through a deliberately configured compatible endpoint/token/model, not as a separately supplied integration. Stored provider remains `huggingface`. |
| Ollama identify, same file | `llava:latest` | `DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK=true`; endpoint `OLLAMA_BASE_URL`, default `http://127.0.0.1:11434`; ID `OLLAMA_IDENTIFY_MODEL`. Server sends image bytes to `/api/chat`. Last fallback; not bundled or hosted automatically. |
| Printed OCR, same file | `microsoft/trocr-large-printed` | Runs for explicit label/part-number/text requests or `too_blurry` label rescue if a token exists. Token precedence here is `HUGGINGFACE_API_KEY`, `HF_API_TOKEN`, `HF_TOKEN`. Override `HUGGINGFACE_OCR_MODEL`. POST image bytes to `https://api-inference.huggingface.co/models/{encoded-model}`; 12-second timeout. OCR failures leave visual identification available. Genuine extracted text becomes `OCR label text:` evidence. |

`src/screens/Scanner.tsx` warms SlimSAM and MVANet after scanner entry. Focused scans use SAM → MVANet → crop, with a combined 3-second visual preparation budget; optional scene isolation has a 1-second budget. Browser APIs and WebGPU support are checked. Unsupported/slow devices use crop or full frame; that fallback does not remove the models from the app. Browser weights are fetched on demand through Transformers.js, not copied from a desktop model directory.

`src/services/aiService.ts` uses the cloud API when online and considers the explicitly enabled CLIP estimate only in its existing failure/offline cases. Real provider errors are retained; no sample output is shipped as a successful AI response.

Chat remains Gemini-specific: `GEMINI_CHAT_MODEL` → `GEMINI_TEXT_MODEL` → default flash; fallback lists `GEMINI_CHAT_FALLBACK_MODELS`, `GEMINI_FALLBACK_MODELS`, default flash-lite. `DEEPSPEC_ENABLE_CHAT` explicitly controls enablement; production defaults disabled. The newer #124 photo-backed chat and explicit Research path are legitimate additions: saved images are bounded and loaded in the browser, the server receives inline image bytes, and Research uses Gemini Google Search plus URL context. Only returned grounding/retrieval metadata becomes cited research sources. This is a separate usage/cost path from identification credits. A YouTube reference does not mean the app watched a video.

The SAM, MVANet and CLIP source files are byte-unchanged between PR #119 and the inspected #124 head. The identify implementation has two legitimate changes: HF-only configuration can now run without a Gemini key and its failure is retained; extracted OCR evidence is retained when six evidence slots were already occupied. Those fixes must remain.

`.env.example` had stale prose naming SmolVLM rather than the actual CLIP implementation and describing Groq after Gemini. This repair corrects those comments only, without changing configuration values.

## Dataset context and files

`server/identify.shared.ts` reads JSONL indexes using Node `fs`, not a remote dataset service:

- `DEEPSPEC_DATASET_INDEX_PATHS` (semicolon/comma-separated) takes precedence over `DEEPSPEC_DATASET_INDEX_PATH`.
- Defaults: `datasets/derived/drbimmer-car-parts-and-damage-dataset/records.jsonl` and `datasets/verified/hf-automotive-sources-v1/records.jsonl`.
- With `DEEPSPEC_ENABLE_DATASET_SOURCE_CONTEXT=true`, up to 24 label/source summaries supplement provider prompts. Labels are supporting context only when image evidence agrees.
- Result normalization also matches dataset labels/source URLs. Missing indexes fall back to class metadata under `DEEPSPEC_DATASET_ROOT`, default `datasets/raw/drbimmer-car-parts-and-damage-dataset`.
- `datasets/raw/` and `datasets/derived/` are Git-ignored; this checkout cannot establish their desktop contents. Missing files return empty context/matches rather than proving deletion.
- The tracked verified HF automotive index is explicitly included in the identify serverless bundle through `vercel.json` `functions.api/identify.ts.includeFiles`. Custom indexes or raw metadata need a deliberate reviewed bundle/storage plan. Git does not upload desktop-only files.

This is contextual retrieval/matching, not training or a model fine-tune. No dataset was generated, copied from the desktop, downloaded or exported during this audit.

## Configuration boundaries and required scopes

| Names | Scope and purpose | Readiness that remains to verify |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Public **build-time** browser configuration for registered auth, cloud history and sync. They must point to the same intended project. | Intended Vercel Preview and/or Production build scope; authenticated owner-scoped reads/writes; private `scan-images` signed URLs. A rebuild is required after changing browser variables. |
| `VITE_ENABLE_GOOGLE_AUTH`, `VITE_ENABLE_GITHUB_AUTH` | Optional public build-time UI flags. | Enable only existing configured auth methods. Verify the exact hosted origin/callback allowlist; no auth provider/security changes are authorized here. Email/password/link/code paths are already present. |
| `SUPABASE_URL` (fallback `VITE_SUPABASE_URL`), `SUPABASE_SECRET_KEY` (fallback `SUPABASE_SERVICE_ROLE_KEY`) | **Server runtime only**, Supabase administrative API access for session checks, distributed quotas, entitlements/credit RPCs. Never prefix privileged keys with `VITE_`. The opaque-secret-key transport is already implemented. | Exact deployment target's bindings, key validity, migrations/RPC permissions. Secret bindings in Codex/GitHub/desktop do not establish Vercel runtime bindings. Existing keys must be checked without printing/copying values. |
| `DEEPSPEC_REQUIRE_SESSION` | Existing server auth switch. Identify also verifies the account when reserving a credit; chat needs this existing session switch to enforce server sessions. | Report the deployed setting and test the authorized account. Changing this security setting requires approval; this repair does not configure it. |
| `GEMINI_API_KEY`; `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | Existing provider key and model choices in **server runtime**. Key needs Gemini API/model access in its existing project, with applicable restrictions/quotas. | Correct Vercel project/environment/branch scope and deployment binding; one explicitly authorized real request. A nonempty binding alone is not proof of validity. |
| `DEEPSPEC_ENABLE_CHAT`; `GEMINI_CHAT_MODEL`, `GEMINI_TEXT_MODEL`, `GEMINI_CHAT_FALLBACK_MODELS` | Server runtime; optional chat and model routing. | Existing approved setting/budget/kill switch, provider access and grounding availability. Do not enable chat automatically to make a preview work. |
| `GROQ_API_KEY`, `DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK`, `GROQ_IDENTIFY_MODEL`, `GROQ_IDENTIFY_ENDPOINT_URL` | Server runtime; existing optional Groq inference capability. | Existing key's model/project inference access and approved tier. No new provider is required to diagnose Gemini's missing configuration. |
| `HF_TOKEN` / `HF_API_TOKEN` / `HUGGINGFACE_API_KEY`, `DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK`, `DEEPSPEC_FORCE_HF_IDENTIFY`, `HF_IDENTIFY_MODEL`, `HF_IDENTIFY_ENDPOINT_URL`, `HF_IDENTIFY_PROVIDER`, `HUGGINGFACE_OCR_MODEL` | Server runtime; HF Inference Providers/model access, or a deliberately selected compatible service's existing token. OCR and identify can use the same aliases with different precedence. | Existing token's inference access, chosen model availability and endpoint compatibility. OCR's legacy endpoint reachability remains unresolved; do not silently switch model/service. |
| `DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK`, `OLLAMA_BASE_URL`, `OLLAMA_IDENTIFY_MODEL` | Server runtime; separately running service. | Hosting decision below; localhost on Vercel is the function container, not the desktop. |
| `VITE_DEEPSPEC_PROMPTABLE_SEG*`, `VITE_DEEPSPEC_SEGMENTATION*`, `VITE_ENABLE_ON_DEVICE_FALLBACK` | Public browser build-time feature/model settings described above. | Real browser model-host access, WebGPU compatibility/memory on supported phones; no private inference key should be placed here. |
| `DEEPSPEC_ENABLE_DATASET_SOURCE_CONTEXT`, `DEEPSPEC_DATASET_ROOT`, `DEEPSPEC_DATASET_INDEX_PATH`, `DEEPSPEC_DATASET_INDEX_PATHS` | Server runtime paths into deployed files. | Bundle contains intended reviewed metadata/index; ignored desktop datasets are not automatic. |

Existing performance controls are preserved: `DEEPSPEC_IDENTIFY_PROVIDER_TIMEOUT_MS`, `DEEPSPEC_GEMINI_IDENTIFY_HEDGE_DELAY_MS`, `DEEPSPEC_GEMINI_IDENTIFY_THINKING_BUDGET`, `DEEPSPEC_HF_IDENTIFY_TIMEOUT_MS`, `DEEPSPEC_GROQ_IDENTIFY_TIMEOUT_MS`, `DEEPSPEC_OLLAMA_IDENTIFY_TIMEOUT_MS`, `DEEPSPEC_BACKUP_RATE_LIMIT_RETRIES`, `DEEPSPEC_BACKUP_RETRY_BACKOFF_MS`, and browser `VITE_DEEPSPEC_IDENTIFY_CLIENT_TIMEOUT_MS`. Deployment duration limits must cover the chosen existing provider chain and retries; desktop timings do not establish serverless limits.

No billing credentials are needed merely to host the free account journey, but credit/entitlement database prerequisites still apply. Optional existing billing is retained: `BILLING_PROVIDER`, `DEEPSPEC_PUBLIC_URL`, `DEEPSPEC_ENABLE_LIVE_BILLING`, Polar/Stripe keys and product/price mappings. Do not enable billing or run checkout/webhook verification without separate authorization. The narrow dedicated-QA credit exemption is not ordinary account access and must not be used to bypass production limits.

Existing server limits are identify **15/minute + 150/day per IP**, chat **30/minute + 300/day per IP**, backed by Supabase `check_rate_limit`. Production fails closed with 503 when configuration/IP/RPC decisions are unavailable. Identify reserves/finalizes scan credits through `reserve_scan_credit` / `finalize_scan_credit`; registered, confirmed accounts have the existing five free attempts. Keep these guards and account ownership checks. Cloud storage uses private `scan-images`, `scan_lookups` and associated model/detail/sync tables/RPCs; preserve existing RLS and owner predicates. No migration or RLS change was performed.

## Hosted configuration diagnosis

A `500/not_configured` from identify can originate from different layers. The rate limiter, optional session gate, identify provider validation, and scan-credit configuration each have separate prerequisites. Preserve the error's exact safe message/code and request location when diagnosing. In provider validation, no Gemini key and no enabled/configured fallback produces the reported AI `not_configured` response before inference; it does not prove a key was deleted from any other environment. For chat, a disabled feature is 503 `feature_disabled`; enabled chat without `GEMINI_API_KEY` is 500 `not_configured`.

Desktop `npm run dev` reads local `.env*` through Vite's `loadEnv` and runs API middleware locally. Vercel's `api/*.ts` uses its deployment's runtime `process.env`. `vite preview` only registers method guards, not the full API handler implementations; a static `dist` host alone cannot serve working identify/chat. Git synchronizes tracked source; it does not synchronize secret stores, localhost services, browser storage or ignored datasets.

The initial #124 `vercel.json` included guest-preview environment overrides. The repair removes the guest entry behavior while retaining explicit API routing, the verified dataset bundle and SPA handling. No existing deployment settings are changed by this local work. A new approved deployment is necessary for these source repairs to affect the hosted app.

### Safe reachability evidence

Unauthenticated HEAD requests on 2026-10-29, no body/credential/model weights downloaded and no inference call:

| Endpoint | Observed result | What it establishes |
| --- | --- | --- |
| `https://deepspec-git-codex-v1-brand-motion-refresh-deep-spec-team.vercel.app/` | 200 HTML | Existing hosted page responds. It is the pre-repair deployment. |
| Same host `/auth` | 200 HTML | SPA document responds; this alone does not prove login behavior. |
| Same host `/api/identify`, `/api/chat` | 405 JSON each | API method guards respond; no provider/configuration/authorized POST tested. |
| `https://generativelanguage.googleapis.com/` | 404 HTML | Host is reachable only. No key/model access verified. |
| `https://api.groq.com/openai/v1/models` | 404 JSON on HEAD | Host responds only; no model/key availability verified. |
| `https://router.huggingface.co/v1/models` | 200 JSON headers | Router responds only. |
| `https://api-inference.huggingface.co/models/microsoft%2Ftrocr-large-printed` | Proxy CONNECT 403, curl exit 56, no HTTP origin status | This cloud environment could not reach the configured OCR host. It is not evidence that the OCR service/model itself failed. Deployment egress and endpoint support remain unverified. |
| `https://huggingface.co/{Xenova/slimsam-77-uniform,onnx-community/MVANet-ONNX,Xenova/clip-vit-base-patch32}/resolve/main/config.json` | 307 each, redirects not followed | Source model configuration URLs respond. No weights/runtime/model quality verified. |

No authenticated Supabase query, real provider call, live account journey or physical-phone check was performed in this audit. Root verification records automated/mocked and local browser results separately.

Focused verification: `npx vitest run src/lib/promptableSegmentation.test.ts src/lib/productSegmentation.test.ts src/services/onDeviceIdentify.test.ts --configLoader native --pool threads --maxWorkers=1 --no-file-parallelism` passed **3 files / 27 tests**. These exercise flags/defaults, WebGPU/fallback gates and model wrapper behavior with test doubles; they do not load real weights or establish inference quality. `git diff --check` passed for the audit changes.

## Exact remaining hosting decisions and acceptance checklist

1. **Select and approve the deployment target:** the existing DeepSpec Vercel project and exact Preview/Production scope/branch/domain to host this repair. Source is prepared locally; pushing, publishing and deployment remain prohibited until specifically approved. A static marketing Site is insufficient for `api/*.ts`.
2. **Confirm existing configuration in that target:** an authorized operator checks variable names/binding scope without exposing values, public Supabase project alignment, current key restrictions and required database/RPC/private storage availability. No credentials will be generated, copied, rotated or configured without approval. Also resolve the prior PR #119 security launch gates through an explicitly authorized process; this repair does not change security settings.
3. **Decide Ollama parity:** if exact Ollama fallback is required without the desktop, choose an independently hosted reachable Ollama service with the existing model, access controls, capacity and budget. That is a separate hosting/access/cost decision. Otherwise retain the implementation but do not claim that fallback is deployed or tested. A Vercel localhost URL cannot reach the desktop.
4. **Decide dataset parity:** use the tracked verified index already bundled, or explicitly approve which existing desktop-only indexes/metadata may be packaged or served from durable storage. Inspect desktop uncommitted work/configuration separately before later integration; this clean checkout cannot reproduce it.
5. **Review provider-chain costs/duration:** verify the intended existing provider/flags and hedged/fallback requests against an approved no-spend verification path. Confirm the OCR endpoint from the deployment network before claiming OCR works. No substitutes or mock answers count as live acceptance.
6. **After deployment approval:** build with intended public variables and server bindings, verify `/` intro → `/auth` login → protected app, safe back/deep-link/reload behavior, API 405 responses and authenticated requests. Check that no HTML fallback intercepts `/api/*` and dataset bundle files exist.
7. **With specifically authorized test accounts/data and provider usage:** sign in → real upload → result → save → cloud confirmation → history → refresh → logout/login → reopen; verify another account cannot read it, old/failed requests cannot cross account boundaries, recovery preserves the original photo/result, and rate/credit limits still deny appropriately. Do not invoke broad scripts that create/delete live records as a supposedly read-only diagnostic.
8. **Physical-phone acceptance:** open the hosted HTTPS URL with desktop off, test camera/upload permissions and narrow-screen navigation, reduced motion/accessibility, real model downloads/WebGPU fallbacks, save/reopen and second-device cloud history. Browser emulation is not proof of actual iOS/Android acceptance.

The immediate blockers are target-specific deployment/configuration access and explicit deployment/credential/provider-usage approval, plus the Ollama/dataset parity decisions if desktop-equivalent behavior is required. The repair can be reviewed and tested locally without resolving those independent hosting decisions.
