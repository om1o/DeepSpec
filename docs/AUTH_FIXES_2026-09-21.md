# Authentication fixes — September 21, 2026

## Changes

- Confirmation-required signup now asks the user to check their inbox, without suggesting disabling confirmation or activating an unverified account.
- Login requests cannot overlap through mode changes, resends, or repeated submission. Existing password sign-in no longer applies the new-account eight-character minimum.
- Failed logout immediately locks protected screens, even without an SDK auth event. A persisted pending marker blocks automatic restoration after reload; retry logout or a fresh verified sign-in recovers access.
- Logout generation checks reject stale verification/sign-in results across tabs. Cached identities are invalidated after a completed logout, and an older logout cannot clear a newer pending marker.
- Temporary accounts explain their recovery limitations.

## Verification

- Focused Auth, auth service, App, and History tests: 92 passed. After the final cache-generation regression was added, all 34 auth-service tests passed (93 distinct tests across these files).
- ESLint and production TypeScript/Vite build passed. Vite retains its existing large-chunk warning.
- QA doctor passed with QA_BASE_URL=http://127.0.0.1:3000. An invocation without this environment variable reported missing env, then passed when supplied.
- Live browser QA passed anonymous login, session restoration without upload replay, and shared-device account switching.
- Browser report: artifacts/qa/2026-09-21T13-05-19-924Z/report.md; screenshots, trace, and video are in the same directory. This browser run preceded the final cache-generation guard; that guard was verified by its service regression test.
- Supabase auth settings endpoint was reachable; signup and anonymous login were enabled.

## Remaining verification limits

- Real password sign-in and email delivery/code confirmation were skipped because no dedicated test credentials or inbox/code were supplied. Automated mocks cover these application flows, but do not prove provider email delivery.
- OAuth providers are not enabled in the local build; no live OAuth test was claimed.
- A failed provider logout does not prove remote token revocation. The local lock protects app screens; browser storage being unavailable limits persistence across reloads.
- These changes do not introduce tester allowlists or a password-reset feature, and were not deployed to the separate hosted testing site.

Provider contract checked: https://supabase.com/docs/reference/javascript/auth-signup — a successful signup can return no session when email confirmation is enabled.
