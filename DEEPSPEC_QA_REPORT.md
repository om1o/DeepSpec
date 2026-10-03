# DeepSpec QA Report

Generated: 2026-10-03

## Executive Summary

DeepSpec is closer, but I would not call it launch-ready from this run alone. The pre-identification scanner hang was reproduced and fixed, account/tooling UI QA failures were fixed, and the fixed scanner path was independently retested through the real browser with Supabase persistence. The remaining launch blocker is backend AI provider reliability: a full post-fix QA run still failed `scanner-ai-engine` when the provider fallback chain returned 403/502/429 responses.

## Coordination And Lane Discovery

- Current orchestrator lane: unknown/current Codex task `01a0ffb7-7e80-7b83-8356-eb23e3904802`.
- Read-only discovery worker: `01a0ffba-5c39-7812-b91d-f64c0754b6c7`.
- No verified lane-number manifest or confirmed `Lane 3` auth owner was accessible. Ownership remains task/worktree-based, not lane-number-based.
- Active related tasks discovered:
  - `01a0ff7f-033e-7dc2-a629-df6389ab46fe`: creative/poster work in the main checkout.
  - `019f95fe-42e0-7952-9ac7-319391fd6005`: launch/founding-tester work in `C:\Users\omiol\.codex\worktrees\deepspec-founding-testers`.
- Pre-existing modified file not owned by this QA run: `src/components/scanner/CropBox.tsx`.

## Evidence Paths

- Initial full QA: `C:\Users\omiol\deepspec\artifacts\qa\2026-10-03T03-14-20-956Z\report.md`
- Focused post-fix QA harness route-timeout artifact: `C:\Users\omiol\deepspec\artifacts\qa\2026-10-03T03-44-56-418Z\report.md`
- Full post-fix QA: `C:\Users\omiol\deepspec\artifacts\qa\2026-10-03T03-50-24-384Z\report.md`
- Manual scanner retest evidence: browser run against `http://localhost:5174/scan`, uploaded `public/test-fixtures/engine-scan-test.jpg`, observed `/api/identify` HTTP 200, result heading `Engine`, and visible `Scan saved to cloud.`

## What Passed

- Full post-fix automated QA passed: `auth-login`, `scanner`, `saved-history`, `result-detail`, `result-chat`, `early-access`, `api-cloud-health`, `pricing`, `checkout`, `account-entitlements`, `shop-onboarding`, `create-job`, `job-scan`, `job-result-correction`, `add-vin-after-result`, `second-angle-refinement`, `shop-history-search`, `customer-report-export`, `org-member-permissions`, `billing-provider-fail-closed`.
- Manual browser retest passed for the core scanner fix: no-email auth, upload, `/api/identify`, result rendering, cloud storage write, database inserts, and visible cloud-save completion.
- Code checks passed:
  - `npm test -- src/screens/Scanner.test.tsx src/screens/Result.test.tsx` passed 49 tests.
  - `npm run lint` passed.
  - `npm run build` passed.

## Failures And Fixes

### Fixed: scanner upload could hang before AI identify

- Severity: high.
- Reproduction: upload the engine fixture while camera is blocked/unsupported. Before the fix, the flow could stay in the scan/loading state and never call `/api/identify` when product segmentation skipped or failed to return.
- Fix: added a 3.5s timeout around `createSegmentedProductIsolation`, then continue with the focused crop if segmentation does not return.
- Files: `src/screens/Scanner.tsx`, `src/screens/Scanner.test.tsx`.
- Retest: manual browser retest reached `/api/identify` HTTP 200 and rendered an `Engine` result.

### Fixed: saved scanner cloud persistence was not visible to QA

- Severity: medium.
- Reproduction: scanner result rendered, but QA could not tell whether backend save finished.
- Fix: show `Saving scan to cloud...`, `Scan saved to cloud.`, configured-off, or failure status.
- Files: `src/screens/Scanner.tsx`, `src/screens/Scanner.test.tsx`.
- Retest: manual browser retest observed `Scan saved to cloud.` after Supabase storage/database responses.

### Fixed: account entitlement fail-closed copy was missing

- Severity: medium.
- Reproduction: automated QA expected explicit fail-closed paid-access copy on the account page.
- Fix: added visible copy: `Paid access remains fail-closed until server entitlement verification confirms an active plan.`
- Files: `src/screens/Account.tsx`.
- Retest: full post-fix QA passed `account-entitlements`.

### Fixed: saved scan tools were not collapsed

- Severity: low/medium.
- Reproduction: job result QA expected `Saved scan tools`; the tools were visible instead of grouped.
- Fix: wrapped trust/report actions in a `details` section labeled `Saved scan tools`.
- Files: `src/screens/Result.tsx`, `src/screens/Result.test.tsx`.
- Retest: full post-fix QA passed `job-result-correction`.

## Remaining Launch Blocker

### scanner-ai-engine provider chain can still fail

- Severity: high.
- Full post-fix QA failure: `scanner-ai-engine` failed with `/api/identify=502` after about 130 seconds.
- Server evidence from the same run: Groq returned 403, Gemini returned 502, Gemini flash-lite returned 502, and Hugging Face returned 429.
- Observed impact: the browser fell back to the camera-blocked/upload state instead of producing a usable AI result.
- Likely files to inspect next: `api/identify.shared.ts`, `src/services/aiService.ts`, provider configuration/env, retry/fallback policy, and quota/rate-limit handling.
- Recommendation: treat provider-chain reliability as a launch blocker. Do not call scanner AI production-ready until either the configured primary provider is stable or the app has a reliable deterministic fallback/error path that is acceptable for launch.

## Blocked Or Untested

- The requested `internetmaven123@gmail.com` password login was not completed because no password should be inspected or reset, and no user-entered password was provided. The QA run used the supported no-email Supabase QA path.
- Physical camera and device-specific camera permission behavior were not fully exercised in this desktop/headless environment.
- No payments, billing changes, password resets, destructive migrations, or data deletion were performed.
- Headed/manual visual mobile sweep was not completed beyond the automated desktop browser flows in this run.

## Test Data Created

- No-email Supabase QA auth sessions/users were created by the app's supported QA path.
- Scanner retests uploaded `public/test-fixtures/engine-scan-test.jpg`.
- Supabase storage/database test records were created for successful scanner saves. Existing user data was not deleted.

## Current Ownership

- Auth/session owner: unknown.
- Upload/identification owner: unknown.
- Saved history/backend owner: unknown.
- UI owner: unknown.
- Current orchestrator owns this QA report, coordination board, and the scoped local fixes until the commit is handed off.

## Prioritized Next Steps

1. Fix or harden `/api/identify` provider fallback behavior under 403/502/429 responses.
2. Add a deterministic QA-mode or fixture-backed backend path if the launch checklist must be stable without spending provider quota.
3. Rerun full `npm run test:website` after provider reliability is addressed.
4. Complete a real mobile/physical camera pass before launch.
