# Deep Spec Production Readiness Completion Audit

Audit date: May 23, 2026
Branch audited: `codex/deepspec-v61-dataset-metadata`
Head audited: `2e49159609c58bfe7f6189bc4928fba77c7494ee`

## Verdict

Deep Spec is not production-level yet.

The app-side release work is materially better: test scan mode is deterministic, provider evals are throttled, result data is structured, the result screen is image-first, and local dataset export is schema v2 with image metadata. The remaining blockers are still real blockers, not paperwork: hosted Supabase anonymous Auth fails before private storage/RLS can be proven, live provider upload/public eval cannot run without `GEMINI_API_KEY`, and the active GitHub PR cannot be retargeted from this environment because GitHub write auth is unavailable.

## Prompt-To-Artifact Checklist

| Requirement | Artifact or command checked | Evidence | Status |
| --- | --- | --- | --- |
| Release-safe provider plan | `docs/AI_PROVIDER_RELIABILITY_PLAN.md` | Documents no-provider QA test mode, beta eval, public eval, Retry-After handling, provider-failure accounting, and fallback model env vars. | Implemented, still needs live public eval. |
| Throttled evals | `scripts/eval-identify.mjs`, `package.json`, `scripts/eval-identify.test.mjs` | Default delay is `20_000`; `--delay-ms` is supported; public command runs 300 samples with summary verification. | Implemented. |
| Rate-limit fallback models | `api/identify.shared.ts`, `api/chat.shared.ts`, `api/identify.shared.test.ts`, `api/chat.shared.test.ts` | `GEMINI_FALLBACK_MODELS` and `GEMINI_CHAT_FALLBACK_MODELS` are parsed before built-in fallback models. | Implemented. |
| `/scan?test=1` passes consistently | Browser smoke at `http://127.0.0.1:5193/scan?test=1` | Mobile viewport `390x844` showed `Test scan ready`, no camera wall, clicked `Test engine photo`, reached `/result`, rendered `Alternator`, Match/Evidence/Sources tabs, alternatives, and no captured console/page errors. | Implemented for QA fixture. |
| Supabase anonymous auth/cloud sync proven | `npm run verify:supabase` | Fails at `[1/6] Signing in as an anonymous Supabase user...`; latest request/error id `019e5276-9c96-7bb8-8d83-0e6b10dfd994`; storage/RLS checks never run. | Blocked. |
| Honest cloud readiness copy | `src/services/cloudSync.ts`, `src/services/cloudSync.test.ts` | Configured copy says cloud sync is configured but not verified, and runtime health tracks Auth, storage upload, row upsert, RLS isolation, and last verified. | Implemented. |
| Clean release stack | GitHub public pull request API | Only one open PR exists, #103, but it points at protected branch `codex/deepspec-v59-provider-fallback` instead of latest v61. | Partially implemented; PR retarget/create blocked. |
| Lens-like result data | `src/types/index.ts`, `api/identify.shared.ts`, `src/services/systemPrompts.ts` | `IdentificationResult` includes `candidateMatches`, `evidenceRegions`, and `sourceLinks`; prompts ask for ranked candidates, anchored evidence, and ranked safe links. | Implemented baseline. |
| Lens-like result UX | `src/screens/Result.tsx`, `src/screens/Result.test.tsx` | Result has image-first layout, evidence callouts, Match/Evidence/Sources/Ask tabs for real scans, candidate correction, uncertainty, and grouped source cards. | Implemented baseline; exact boxes/masks and final mobile polish remain. |
| Immediate ask/refine actions | `src/screens/Result.tsx`, `src/screens/Result.test.tsx` | Real unsaved scans are saved before chat; saved scans open chat with typed `?q=` context; QA test scans intentionally hide Ask. | Implemented. |
| Dataset-grade local persistence | `src/services/storage.ts`, `src/services/storage.test.ts` | `MAX_SAVED_LOOKUPS = 300`; `DATASET_EXPORT_SCHEMA_VERSION = 2`; exports include image, image hash, MIME type, byte length, result, candidates, evidence, sources, chat, review, model runs, OCR, and sync events. | Implemented as local fallback. |
| Dataset-grade cloud persistence | `src/services/cloudSync.ts`, Supabase verifier | Cloud metadata uses the dataset metadata shape, but real cloud persistence is not proven because Supabase Auth fails before storage/RLS. | Blocked. |
| Release CI quality gate | GitHub check runs for `2e49159609c58bfe7f6189bc4928fba77c7494ee` | Remote Quality gate passed; Supabase Preview skipped on branch push. | App gate green; release cloud gate still not proven. |

## Current Blockers

1. Supabase hosted Auth/database repair is required. Anonymous sign-ins are enabled, but anonymous user creation returns `unexpected_failure` HTTP 500. Until `npm run verify:supabase` passes all 6 steps, private storage, row ownership, and RLS are not proven.
2. Supabase repair cannot be applied from this environment. Missing: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `DATABASE_URL`, `PGHOST`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`. The Supabase dashboard browser session is also signed out.
3. GitHub PR cleanup cannot be completed from this environment. `gh` is not installed, `GH_TOKEN` and `GITHUB_TOKEN` are missing, the GitHub connector write token is revoked, and the GitHub browser session is signed out.
4. Live provider upload and the 300-case public eval cannot be production-proven here because `GEMINI_API_KEY` is missing.

## Next Unblock Steps

1. Authenticate Supabase or provide a privileged Postgres connection.
2. Inspect Auth logs for request id `019e5276-9c96-7bb8-8d83-0e6b10dfd994`.
3. Run `npm run supabase:print-auth-diagnostics` and apply the anonymous-user repair only if diagnostics confirm the standard profile trigger path.
4. Rerun `npm run verify:supabase` until all 6 steps pass.
5. Restore GitHub write auth, then open or retarget the release PR to `codex/deepspec-v61-dataset-metadata`.
6. Add `GEMINI_API_KEY`, rerun live upload identify, and run `npm run eval:identify:public` with enough quota/time.
