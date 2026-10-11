# DeepSpec V1 Preview QA Report

Date: 2026-10-11 (America/New_York)

Current verified local candidate: `aef05dc3`. The deployed branch preview still runs `f9532ab0`; its API functions fail during ESM module loading. The three newer repair commits are local only and have not triggered CI or a deployment.

Pull request: https://github.com/om1o/DeepSpec/pull/119

PR #119 is the selected V1 integration path. PR #120 was closed without merge or deployment after its `vercel.json` blob was verified byte-identical to the copy already in PR #119.

## Executive Verdict

DeepSpec is not yet approved for V1 preview promotion. The local release code is substantially healthier and the accessible local gate is green, but five launch blockers remain:

1. Replace the exposed legacy Supabase `service_role` credential with a new server-only secret key, verify every consumer, then deactivate the legacy key.
2. Configure dedicated confirmed QA credentials (including the second isolation account), disable anonymous sign-ins, and rerun the live verifiers. Enable leaked-password protection where the Supabase plan supports it.
3. Prove one AI provider completes an ordinary scan on the candidate environment without violating the no-spending rule.
4. Pass the real verified-account journey: sign in, restore session, scan, save, history, refresh/reopen, logout/login, and reopen again.
5. Push the verified Vercel ESM repair and prove the exact deployed preview returns controlled auth errors instead of `FUNCTION_INVOCATION_FAILED`.

No merge, production deployment, or manual promotion was performed. Vercel automatically built the branch preview linked below.

## Current Local Candidate Verification — 2026-10-11

Candidate: `aef05dc3` on `codex/v1-preview-20261010`, three commits ahead of the deployed/remote branch head `f9532ab0`.

- `0dac56e9` routes the billing webhook replay verifier through the shared opaque-key-safe Supabase admin client. Its 41 focused tests, syntax checks, ESLint, production build, and public-asset verification passed.
- `f8b4c990` stops `verify:auth` after an actionable missing-public-config error instead of continuing into an undefined `.replace` crash. The regression failed before the fix and all 12 verifier tests pass after it.
- `aef05dc3` fixes Node ESM resolution for all six Vercel API functions, uses compiler-stable discriminant checks, removes the incompatible `Array.at()` call, and excludes generated `.vercel` output from source linting.
- Live Vercel logs for deployed `f9532ab0` reproduce `ERR_MODULE_NOT_FOUND` for `/var/task/server/identify.shared`; unauthenticated `/api/identify` requests therefore return platform HTTP 500 before the handler runs.
- Local verification for `aef05dc3`: 155 focused server/API tests passed; the full suite passed 95 files / 1,297 tests; ESLint passed; production build and public-asset verification passed; `vercel build --target preview` completed with zero TypeScript diagnostics; direct import of the emitted function returned `401 missing_session` without a Supabase or provider request.
- The repairs are intentionally unpushed. Rerunning CI before anonymous sign-ins are verified off would only repeat the known live-auth failure.

- `b33a2f40` preserves exact QA password bytes while still rejecting blank-only values, and preserves pending rating/correction through repeated local-storage quota failures. The two matching PR #119 review threads are resolved.
- Full local suite on the runtime fix: 94 files and 1,291 tests passed. Node syntax checks, full ESLint, TypeScript, and the production build passed.
- `fb331d6f` integrates the public-asset integrity gate from the now-closed duplicate PR #121. Its focused test, full ESLint, and the combined production build passed; the post-build asset check found no missing internal target.
- `7c343262` prevents opaque `sb_secret_...` admin keys from being copied into the bearer header while preserving explicit user JWTs, and makes shared-device QA consume the documented `DEEPSPEC_AUTH_TEST_OTHER_*` account variables without trimming password bytes. Both new PR review threads are resolved.
- Verification for `7c343262`: 78 focused tests passed; TypeScript and QA script syntax checks passed; full ESLint passed; production build and public-asset verification passed. The Windows full suite passed 92 files / 1,228 tests but reported five Scanner timeouts plus two worker-start failures after resource exhaustion. Fresh isolated reruns of Scanner, Auth, and History passed 3 files / 111 tests, including every timed-out case.
- Vercel preview: https://deepspec-git-codex-v1-preview-20261010-deep-spec-team.vercel.app
- Vercel Preview now has the public Supabase URL and publishable-key variables. The authorized rebuild for `9abd9be7` succeeded. Preview QA doctor `artifacts/qa/2026-10-11T15-12-04-588Z/qa-doctor.md` returned HTTP 200, found the current auth selectors, and captured no console or network errors.
- Direct phone-viewport evidence `artifacts/qa/2026-10-11T15-12-04-588Z/screenshots/auth-visible.png` confirms the Account form is visible and the earlier “Sign-in unavailable” state is absent. The doctor still reports missing local env because this isolated checkout intentionally has no copied Supabase values or authorized account password.
- Authenticated browser QA remains blocked honestly: no authorized password or reusable signed-in browser session is available to this lane. No password was searched for, displayed, reset, or sent by email.
- Both earlier Linux Quality gate runs on `d5457fcb` passed lint, all 94 test files / 1,291 tests, and build, then intentionally failed the live auth preflight because Supabase still reported anonymous sign-ins enabled. This is a production configuration blocker, not a code-test failure.

## Anonymous-auth Review Follow-up — 2026-10-11

Verified code candidate: `bc43282f` on `codex/v1-preview-20261010`, based on inspected PR head `0bc7f4d7`. The evidence-only commit containing this section does not change runtime code.

Both open review findings were reproduced in source before changes:
- `PRRT_kwDOSd6dgM6rJmMZ`: app cloud health and auth/cloud CLI verifiers depended on anonymous sign-ins.
- `PRRT_kwDOSd6dgM6rJmMa`: checkout and webhook replay used identities rejected by protected billing/account APIs.

Changes:
- App cloud health server-verifies the active confirmed user and pins its probe/cleanup client to that user's token. Account switches cannot write the old report into a new account. Normal cloud sync rejects anonymous and unconfirmed sessions. Old anonymous-health cache entries are discarded.
- App privacy probes check signed-out access, accepting explicit PostgreSQL permission denial but rejecting leaks and inconclusive network failures. These probes do **not** establish cross-account isolation; the CLI uses two distinct confirmed QA accounts for that check.
- Checkout uses configured confirmed QA credentials. Webhook replay creates a unique disposable confirmed identity using the trusted admin client, then uses its normal public-client session for entitlement and portal APIs. Synthetic grants never target a pre-existing customer account.
- CLI probes preserve password bytes, reject missing/unconfirmed/anonymous identities and same-account isolation tests before fixture writes, revoke only their own sessions, and keep fixture cleanup scoped. Billing success artifacts are emitted only after required cleanup succeeds.
- CI and setup instructions document both confirmed QA accounts; auth preflight requires anonymous sign-ins disabled. No server authorization, RLS policy, paid-credit rule, or scan allowance was weakened.

Earlier anonymous-auth verification in this checkout (Node 24.19.0):

| Check | Result |
| --- | --- |
| `npm run check` | PASS, exit 0; includes full lint, tests, TypeScript and production build |
| Full automated suite | 94 files, 1,291 tests passed; 88.89 seconds |
| Focused app cloud-sync regressions | 90 tests passed |
| Focused CLI/session regressions | 58 tests across 7 files passed |
| `git diff --check` | PASS |
| Final independent cleanup review | No material remaining issue found in checkout/replay paths |

An intermediate full run caught one stale CI-text test assertion (1,276 passed, one failed); it was corrected before the final green gate above. The build retains the existing >500 kB chunk warning (550.87 kB Transformers chunk and 23.6 MB WASM asset).

**Not verified here:** live Supabase auth settings, deployed login, live cloud round-trip/RLS, provider completion, billing sandbox endpoints, physical phones, key rotation, or deployment/promotion. No live account was provisioned, auth email sent, payment made, customer data deleted, or Supabase configuration changed during this follow-up. All new identity/cleanup integration tests used mocks. Configure the dedicated accounts described in `docs/CI_SETUP.md`, install this candidate, disable anonymous sign-ins, and run the live verifiers before promotion. Previous deployment/advisor/browser results below remain historical evidence only.

## Earlier Candidate Evidence (`bdd941b9`; not a live recheck)

- Full automated suite: 91 test files and 1,256 tests passed on `bdd941b9`.
- Repository lint: `npm run lint` passed.
- Production build: `npm run build` passed.
- Vercel packaging: SPA fallback preserves `/api/*` and supports direct client routes; current Vercel commit status is successful.
- GitHub review: earlier findings were resolved. Two subsequent anonymous-auth review threads were open at `0bc7f4d7`; this follow-up addresses their code paths.
- Auth UI: anonymous/no-email customer entry was removed; the QA harness now requires configured password credentials and will not create an account or send an email.
- Billing access: anonymous or unconfirmed identities fail closed before checkout, entitlement lookup, and scan allowance.
- No-spend chat: production chat is disabled unless explicitly enabled; after a disabled response the composer cannot accumulate unanswered messages.
- Retry durability: recovered cloud images are bounded; a successful identification remains visible after a local storage failure; retry persists the complete result, frame, provenance, and pending feedback.
- Cross-platform retry recovery: downloaded images are converted from bytes instead of passing a foreign-realm Blob to FileReader; focused Windows tests and both Linux GitHub Quality gates pass.
- Inference truthfulness: unsupported measurements fail closed and changed prompt/pipeline behavior has explicit version lineage.
- Shop authorization: user-controlled membership role escalation is blocked in release code.
- Branding: the blue-slate DeepSpec logo renders on the current local auth screen at the phone viewport.

## Earlier Browser And Environment Evidence (not rerun in this follow-up)

QA doctor report:

`artifacts/qa/2026-10-11T01-50-33-168Z/qa-doctor.md`

Screenshot:

`artifacts/qa/2026-10-11T01-50-33-168Z/screenshots/qa-doctor-page.png`

Observed:

- Local candidate returned HTTP 200.
- Supabase URL and publishable key were present.
- Supabase REST endpoint was reachable.
- Chromium launched; `/auth` returned HTTP 200.
- Screenshot contained visible page content.
- No browser console or network error was captured.
- Current auth selectors passed.

Blocked:

- The authorized QA password was not available to the runner.
- No reusable verified session was available.
- Therefore the authenticated customer journey was not claimed as tested.

## Earlier Production Supabase Evidence (not revalidated in this follow-up)

Project `deepspec` is `ACTIVE_HEALTHY` on Postgres 17.

Production migration history includes:

- `20261010170625 v1_preview_billing_entitlements`
- `20261010170648 v1_preview_free_scan_usage`

Earlier transactional release checks proved the five-free-scan boundary, sixth-scan rejection, unverified-user rejection, reservation/finalization behavior, and cross-user protection. Test fixtures were rolled back; no production customer row was deleted.

The current Security Advisor reports seven INFO findings for RLS-enabled tables without client policies. Direct catalog verification shows all seven grant privileges only to `service_role`, not `anon` or `authenticated`:

- `dataset_members`
- `dataset_versions`
- `feedback_reviews`
- `free_scan_usage`
- `rate_limit_hits`
- `scan_credit_reservations`
- `scan_training_reviews`

These are intentional server-only tables. Adding broad client policies would weaken the intended access model.

Anonymous-access WARN findings remain on user-owned scan/storage/sync rows and public intake flows. Their policies are ownership-scoped or content-validated, but the warning matters while anonymous sign-ins remain enabled. Disable anonymous sign-ins rather than broadening or deleting ownership checks.

Leaked-password protection remains disabled and is a real dashboard hardening item. Supabase documents that it rejects passwords known through the Pwned Passwords service and is available on Pro and above:

https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Performance Advisor findings are debt, not a confidentiality blocker:

- Three unindexed foreign keys.
- Ten currently unused indexes.

Advisor results must be interpreted against the intended access model:

https://supabase.com/docs/guides/observability/advisors

## Supabase Key Rotation Runbook

Supabase is deprecating legacy `anon` and `service_role` keys by the end of 2026. New secret keys can coexist during migration and must remain server-only:

https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys

1. Create a named `sb_secret_...` key in Supabase Dashboard without displaying or copying it into chat, logs, source, or client variables.
2. Set it as `SUPABASE_SECRET_KEY` in Vercel Preview and Production server environments. Keep the legacy variable temporarily for rollback.
3. Redeploy a preview from the approved release commit.
4. Probe server-only consumers: entitlement read, scan credit reserve/finalize, billing webhook verification harness, reviewed-dataset export, and cloud save/read.
5. Confirm browser bundles and public environment output contain no server key.
6. Repeat the authenticated scan/save/history journey on the exact preview revision.
7. If any server probe fails, restore the prior deployment/environment selection while the legacy key is still active and investigate without deactivating it.
8. Only after every probe passes, deactivate the legacy key in Supabase. Supabase states this is reversible if a missed consumer appears.

Opaque secret keys must be sent in the `apikey` header, not as a bearer JWT. The export path now enforces that distinction.

## Reproducible Failures And Blockers

### P0: Exposed legacy server credential is still active

Expected: production server components use a newly created, independently rotatable secret key.

Actual: code is rotation-ready, but external key creation, Vercel installation, verification, and legacy deactivation are not complete.

### P0: Authenticated customer journey is unproven

Expected: a verified user can sign in, restore a session, scan, save, reopen history after refresh and logout/login, and receive correct backend persistence.

Actual: the QA doctor stops at missing password/session. No credential was searched for, printed, reset, or requested in chat.

### P0: Live provider completion is unproven

Expected: at least one configured provider completes an ordinary scan on the candidate revision with provider/model/run evidence.

Actual: unit and fallback tests pass, but no live provider call was made under the no-spending rule. Historical production probes included provider rejection, server failure, or rate limiting and are not launch evidence.

### P1: Supabase Auth hardening remains open and is CI-reproduced

Expected: anonymous sign-ins disabled; leaked-password protection enabled when available.

Actual: advisor warnings remain, and both Linux Quality gate runs reached the live auth preflight and failed on `Disable anonymous sign-ins before preview promotion.`

### P2: Client payload weight

The build succeeds but includes a 550.87 kB minified Transformers.js chunk and a 23.6 MB ONNX WASM asset. This is a mobile performance risk to measure after the P0 gates close.

## Test Data And External Effects

- Production billing/free-scan test fixtures were transactional and rolled back.
- No account was created.
- No password was reset.
- No auth email was sent.
- No payment or paid provider call was made.
- No production deployment, merge, or manual promotion was performed. Vercel's GitHub integration automatically refreshed the branch preview.

## Shortest Remaining Launch Plan

1. Configure confirmed QA accounts as documented in `docs/CI_SETUP.md`; rotate the Supabase server key and harden Auth settings.
2. Produce one approved live provider success on the candidate preview.
3. Have the user enter the authorized account password directly into the browser, then run the full real website QA journey.
4. Re-run Security Advisor, full tests, lint, and build against the final revision.
5. Only then approve and promote the V1 preview.
