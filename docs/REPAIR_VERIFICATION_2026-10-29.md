# DeepSpec intro/account repair verification

## Result and provenance

Prepared locally on `repair/intro-auth-hosting-20261029`. No push, merge, deployment, publication, credential/security-setting change, model download, paid inference or contact with another person occurred.

- Repair baseline: PR [#124](https://github.com/om1o/DeepSpec/pull/124), `f9ba5cc3736b3b16fd1836f8ec4b655cb29d2ec3`. Rechecked its remote head after repair; unchanged. This includes newer full workspace, OCR/source and photo-backed research-chat work after the supplied `76c3e9022e0f496f9020598d9e63f67893e823e7`.
- Auth/account reference: PR [#119](https://github.com/om1o/DeepSpec/pull/119), `c1014e73cb4d5405ea377becb6db70bc3a21c266`; unchanged, open and unmerged. Main was `cdb85936133d05b67cffa83ca87cc88bb30fcd8b` and was not changed.
- Inspected repository `AGENTS.md`, all fetched branch refs, worktree status, recent #124 commits and open PR metadata. #123 identifies itself as superseded by #124. The separate preview-environment diagnostic branch was inspected without incorporating or overwriting it. #124's latest remote CI run, [40800524983](https://github.com/om1o/DeepSpec/actions/runs/40800524983), reported success; local evidence below is independent of that claim.
- The attached workspace was empty before cloning. No existing local changes/worktrees were overwritten. Desktop uncommitted work, private configuration, ignored datasets and browser-local records were inaccessible: **desktop parity unverified**.

## Changes

The application is repaired in place, with no scaffold or broad reset. `/` opens the existing visual intro, whose 13 entries and animated handoff open `/auth`. Login retains its existing password/link/code/OAuth handling and requested-route return. Every application route requires verified auth; obsolete guest flags cannot route around it. The misleading no-account demo entry on login now returns to the intro.

Client account scope, request Authorization, scoped saved history, cloud-sync, sign-out, explicit legacy recovery and training consent use their original authenticated paths. Guest namespace bytes are never read into account records, deleted or silently migrated. Account generation checks, cloud ownership predicates, original limits and recovery confirmation remain. Missing history in the old preview was not treated as deleted data.

API handlers and Vite middleware restore the original session/credit/feature checks and standard distributed limiter. Vercel guest overrides are removed locally. The existing `DEEPSPEC_REQUIRE_SESSION=true` deployment requirement must be verified for the selected scope; its original opt-in behavior was preserved, not silently reconfigured. Intro/SPA/API routes and the serverless verified-source bundle are preserved. Dormant guest quota source and its Edge function are untouched; no remote function/settings change occurred.

The canonical marketing intro and packaging source are updated and regenerated. Animation code, CSS, blue-glass assets, white identity, keyboard handling and reduced-motion behavior remain. The current #124 baseline already fixes the older 144 `no-undef` lint errors using `globals.browser` for generated intro JS; lint coverage was not disabled. Fresh packaging/fingerprinting/idempotence tests guard against source/output drift.

All existing integrations remain: SlimSAM, MVANet, CLIP, Gemini identification/chat, Groq, HF-compatible identification, Ollama, printed OCR and dataset context. No substitutes or app sample answers were introduced. Newer HF-only routing, OCR evidence retention, photo-backed research/chat, and scanner/result workspace fixes remain. See the [source inventory and hosting audit](REPAIR_HOSTING_AUDIT_2026-10-29.md) for exact model IDs, flags, endpoints, variable scopes and limits.

## Commands and evidence

Runtime: Node `v24.19.0`, npm `11.9.0`. Installed only the existing locked repository dependencies with `npm ci --ignore-scripts` (583 packages); package manifests/lockfile were not changed. Existing npm deprecation notices were emitted.

| Command/check | Result and boundary |
| --- | --- |
| `npm run check` | Exit 0: full ESLint; **109 files / 1,552 tests**; `tsc -b`; Vite production build; public-asset and brand checks. Test providers/cloud storage/auth use synthetic/intercepted fixtures. |
| `npm exec -- tsc -b --pretty false` | Exit 0, separate type check. |
| `npm run lint` after browser-runner addition | Exit 0; includes the browser QA script. |
| Focused intro packaging/public validation | 6 tests passed; canonical/native login links, hashes, stale output removal, reproducibility, focus/Escape and both reduced-motion paths. |
| Focused account/services | 7 files / 185 tests passed; authenticated API headers, photo-backed requests, scoped cloud history/save, device save/reopen, account switching/isolation, explicit recovery, preserved guest bytes and 50-record device limit. |
| Focused API/Vite/limiter/layout | 5 files / 68 tests passed; obsolete guest flags, session failure, credits, disabled chat, production fail-closed rate limits and routing/bundle checks. |
| Focused model loaders | 3 files / 27 mocked tests passed for SAM, MVANet and CLIP. No model weights fetched or inference performed. |
| `git diff --check` | Passed. Independent repair review found no blocking regression; generated canonical hashed JS is included explicitly despite `dist/` ignore rules. |

Production build has the existing warning for a minified Transformers chunk above 500 kB. No warning suppression or feature removal was used. Build success does not establish deployed environment configuration or actual model execution.

Full local log: `artifacts/qa/repair-verification-2026-10-29/full-check.log`; separate type-check log is empty on success. Artifacts are Git-ignored local evidence, not remotely published.

## Browser checks and blocked live QA

Ran `QA_BASE_URL=http://127.0.0.1:5178 npm run qa:doctor` first. It reached the local app and imported Playwright, but failed with **missing real Supabase/public/test-account environment**; its default downloaded Chromium was also absent. Report: `artifacts/qa/2026-10-29T01-37-14-310Z/qa-doctor.md`. This is an environment limitation, not a product failure. No browser/software download was used to bypass it.

The dedicated `scripts/qa/intro-auth-browser.mjs` then used the already-installed `/usr/bin/chromium` against local Vite with synthetic Supabase configuration, model loading explicitly disabled and all nonlocal requests intercepted/blocked. Its fake account/result is QA-only and is never presented as actual AI output. All three viewports passed: **1440×1000, 390×844 and 320×740** (reduced motion at 320). Checks covered root intro, 13 login CTAs, keyboard Enter/Escape/focus return with normal motion, reduced-motion handoff, protected history, password sign-in returning to requested history, authenticated refresh, device fixture save/history/detail/reload, scanner entry and sign-out locking history. No horizontal overflow on intro/auth/scanner and no page exceptions. External Google Fonts was blocked. The headless environment has no physical camera; scanner shows its real upload/camera-unavailable state.

Results and 12 screenshots: `artifacts/qa/repair-intro-auth-2026-10-29/`. These establish local UI/storage/navigation behavior only. They do not establish real Supabase persistence, real identification/upload analysis, real camera behavior, Vercel rewrite execution, real OAuth callbacks, phone hardware acceptance or all-model execution. Broad live auth/cloud/evaluation/billing scripts were not run because they can create/delete records, contact providers, send mail or spend quota. The doctor and source audit identify the independent access blockers.

## Remaining deployment decisions

The repair is ready for review; the hosted application has **not** been repaired by a deployment. The [hosting checklist](REPAIR_HOSTING_AUDIT_2026-10-29.md#exact-remaining-hosting-decisions-and-acceptance-checklist) is the concrete next-step plan:

1. Approve the existing Vercel project, exact environment/branch/domain and publication action. No push or deployment is authorized yet.
2. An authorized operator verifies existing browser build variables, server-only Supabase/provider bindings, `DEEPSPEC_REQUIRE_SESSION=true`, approved chat setting, owner-scoped storage/RPC prerequisites and prior #119 launch gates. Any credential or security-setting changes need separate approval. No secret values belong in the report or source.
3. Resolve desktop-independent **Ollama hosting** if that fallback must operate, and **which desktop-only datasets** may be packaged or served. Localhost and ignored filesystem files cannot automatically follow Git into serverless hosting.
4. After authorized deployment/configuration, use specifically authorized accounts/data/provider usage to verify real login → upload → identification → save → cloud history → logout/login → reopen, account isolation and limits. Then open the HTTPS URL on physical iOS/Android with the desktop off. No local mocked result counts as hosted acceptance.

Safe unauthenticated HEAD probes in the hosting audit establish existing hosted document/API-method-guard reachability only. The reported `500/not_configured` remains a deployment-configuration diagnosis, not proof of deleted keys. The current cloud environment has no configured credential bindings, and this task did not inspect or alter Vercel secrets.

## Changed files

Exact paths relative to the repair baseline (`R093` denotes a regenerated filename; `D` removes preview-only code/tests):

```text
M	.env.example
M	api/chat.ts
M	api/identify.ts
A	docs/REPAIR_HOSTING_AUDIT_2026-10-29.md
A	docs/REPAIR_VERIFICATION_2026-10-29.md
M	docs/real-guest-preview.md
M	marketing/deepspec-visual-search/README.md
M	marketing/deepspec-visual-search/dist/index.html
R092	marketing/deepspec-visual-search/dist/signin.6fb70b5db5ff.js	marketing/deepspec-visual-search/dist/signin.50828281d517.js
M	marketing/deepspec-visual-search/dist/signin.js
M	public/intro/index.html
R093	public/intro/signin.4ad21a352ceb.js	public/intro/signin.6353e05f4b94.js
M	public/intro/signin.js
M	scripts/package-intro.mjs
A	scripts/package-intro.test.mjs
A	scripts/qa/intro-auth-browser.mjs
M	scripts/verify-public-assets.mjs
M	scripts/verify-public-assets.test.mjs
M	server/chatHandler.test.ts
M	server/identifyHandler.test.ts
M	server/rateLimit.shared.test.ts
M	server/rateLimit.shared.ts
M	server/vercel-layout.test.ts
A	server/vite-api-gates.test.ts
M	src/App.test.tsx
M	src/App.tsx
M	src/lib/accountScope.test.ts
M	src/lib/accountScope.ts
D	src/lib/guestPreview.test.ts
D	src/lib/guestPreview.ts
M	src/main.tsx
M	src/screens/Account.test.tsx
M	src/screens/Account.tsx
M	src/screens/Auth.tsx
M	src/screens/EarlyAccess.test.tsx
M	src/screens/EarlyAccess.tsx
M	src/screens/History.tsx
M	src/screens/Pricing.test.tsx
M	src/screens/Pricing.tsx
M	src/screens/Result.tsx
A	src/services/accountWorkspace.test.ts
M	src/services/aiService.ts
M	src/services/cloudHistory.test.ts
M	src/services/cloudHistory.ts
M	src/services/cloudSync.test.ts
M	src/services/cloudSync.ts
D	src/services/guestWorkspace.test.ts
M	src/services/storage.test.ts
M	src/services/storage.ts
M	src/services/trainingConsent.ts
M	vercel.json
M	vite.config.ts
```
