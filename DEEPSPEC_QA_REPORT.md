# DeepSpec V1 Preview QA Report

Date: 2026-10-10 (America/New_York)

Candidate: `codex/v1-preview-20261010` at `99a02756`

Pull request: https://github.com/om1o/DeepSpec/pull/119

## Executive Verdict

DeepSpec is not yet approved for V1 preview promotion. The release code is substantially healthier and the accessible local gate is green, but four external launch blockers remain:

1. Replace the exposed legacy Supabase `service_role` credential with a new server-only secret key, verify every consumer, then deactivate the legacy key.
2. Disable anonymous sign-ins and enable leaked-password protection where the Supabase plan supports it.
3. Prove one AI provider completes an ordinary scan on the candidate environment without violating the no-spending rule.
4. Pass the real verified-account journey: sign in, restore session, scan, save, history, refresh/reopen, logout/login, and reopen again.

No merge or manual deployment was performed.

## Verified Passes

- Full automated suite: 91 test files and 1,256 tests passed on `99a02756`.
- Repository lint: `npm run lint` passed.
- Production build: `npm run build` passed.
- Vercel packaging: SPA fallback preserves `/api/*` and supports direct client routes; current Vercel commit status is successful.
- GitHub review: all PR #119 review threads were fixed, independently re-reviewed by the connector, and resolved.
- Auth UI: anonymous/no-email customer entry was removed; the QA harness now requires configured password credentials and will not create an account or send an email.
- Billing access: anonymous or unconfirmed identities fail closed before checkout, entitlement lookup, and scan allowance.
- No-spend chat: production chat is disabled unless explicitly enabled; after a disabled response the composer cannot accumulate unanswered messages.
- Retry durability: recovered cloud images are bounded; a successful identification remains visible after a local storage failure; retry persists the complete result, frame, provenance, and pending feedback.
- Inference truthfulness: unsupported measurements fail closed and changed prompt/pipeline behavior has explicit version lineage.
- Shop authorization: user-controlled membership role escalation is blocked in release code.
- Branding: the blue-slate DeepSpec logo renders on the current local auth screen at the phone viewport.

## Browser And Environment Evidence

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

## Production Supabase Evidence

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

### P1: Supabase Auth hardening remains open

Expected: anonymous sign-ins disabled; leaked-password protection enabled when available.

Actual: advisor warnings remain.

### P2: Client payload weight

The build succeeds but includes a 550.87 kB minified Transformers.js chunk and a 23.6 MB ONNX WASM asset. This is a mobile performance risk to measure after the P0 gates close.

## Test Data And External Effects

- Production billing/free-scan test fixtures were transactional and rolled back.
- No account was created.
- No password was reset.
- No auth email was sent.
- No payment or paid provider call was made.
- No production deployment, merge, or manual promotion was performed.

## Shortest Remaining Launch Plan

1. Rotate the Supabase server key and harden Auth settings.
2. Produce one approved live provider success on the candidate preview.
3. Have the user enter the authorized account password directly into the browser, then run the full real website QA journey.
4. Re-run Security Advisor, full tests, lint, and build against the final revision.
5. Only then approve and promote the V1 preview.
