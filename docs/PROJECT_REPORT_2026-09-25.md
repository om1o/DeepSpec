# DeepSpec engineering and project report — September 25, 2026

Executive summary: DeepSpec has a useful parts-intake prototype, with real cloud scanning and account-isolated saved records. It is not yet a proven paid product. This audit fixes reproducible auth/QA defects and prepares the current integration branch for main. It does not claim every historical feature request or release gate is complete.

## Scope and fixes

The starting worktree was clean at local `27e95cf`; its tree exactly matched GitHub `bd84ece` on `codex/mechanic-shop-mode`. Main was `2843d88` and is already an ancestor of that remote integration branch. PR #114 is the existing integration PR. Historical open PRs contain overlapping and sometimes superseded designs; they must not be blindly merged over current auth, storage and provider behavior.

Assistant-authored fixes in this pass:

1. The auth screen now subscribes to logout-lock changes. A successful logout clears its pending warning without reload; failed logout and cross-tab locking remain protected. Two regressions failed before the fix; affected Auth/service/App suites passed 71 tests afterward.
2. The live auth verifier preserves significant password whitespace and reports which credential flows were skipped. Eight mocked verifier regressions passed. No credentials or tokens are logged.
3. Corrected two failing CI tests: the cleanup test now follows the extracted helper (whose behavior is separately tested), and the report-date test constructs a local date instead of changing a worker's timezone. Cleanup/report tests passed 42 checks under UTC; report tests also passed 13 checks with America/New_York set before process launch.
4. Updated stale browser expectations for locked paid access and result controls. The job correction check now actually edits feedback, reloads, and verifies exact persistence.
5. Missing Supabase CI configuration now blocks PRs targeting main as well as main pushes, avoiding a misleading green premerge result followed by a red main build.

## Runtime evidence

Final code verification: all **74 test files / 965 tests** passed with the repository's default test command. ESLint passed. The local build was interrupted after testing and rerun separately successfully. GitHub independently passed its complete lint/test/build step on commit `0cda74197fd8c7eda30e2714e8ed23675fc4b360`.

**Merge status: not merged.** [GitHub CI run 36207815738](https://github.com/om1o/DeepSpec/actions/runs/36207815738) then failed because Actions secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are absent; cloud verification did not run in CI. The connector can publish commits but exposes no secrets-management action, the local Git credential lookup has no credential, and the connected GitHub browser is signed out. Configure the existing project's public settings through repository Actions secrets, rerun CI, then merge #114 with the verified head SHA. Do not disable the gate or bypass branch protection. Local source and published source trees match.

Identification release evaluation remains **blocked by provider availability**. The first 50-case run was interrupted before it produced a summary; partial passes are not a completed evaluation. A confirmed fresh, sequential 50-case run with one-second spacing, zero rate-limit retries and stop-after-one-provider-failure stopped on its first sample with `rate_limited`. It did not measure 50-case accuracy. No retry loop was used after that quota response.

QA timestamps below are UTC on September 26; the local audit date is September 25 in New York.

| Check | Observed result | Limits |
| --- | --- | --- |
| Initial QA doctor | Failed because port 3000 was not serving the app; server restarted, doctor then passed | Environment failure, not a product defect |
| Full desktop browser run | 19 of 21 passed initially; remaining two were stale selectors, subsequently fixed and passed | Reports below; chat only opened/typed, no live follow-up submission |
| Real engine image | HTTP 200, identified engine assembly, cloud save completed; about 35.3 seconds for upload/AI in that run | One fixture is not general accuracy evidence |
| Mobile browser | Eleven selected auth, account-switching, scanner, history, result, correction, chat-entry and API scenarios passed | Browser emulation, not a physical phone |
| Supabase standard verifier | All nine steps passed, including private images, durable detail rows, owner reads and second-account isolation; fixture cleanup verified | Temporary anonymous auth accounts remain; no shop-member or concurrent-edit proof |
| Inspection verifier | Blocked: hosted `inspection_json` missing; no scan/image fixtures written | Migration requires deployment access |
| Auth settings | Signup and anonymous access enabled; no configured OAuth providers | Real password and received-email-code checks skipped: no test credentials/inbox code |
| Billing readiness | Blocked, provider unconfigured and no checkout/webhook evidence | No payment made or live billing enabled |
| Fifty-image release evaluation | 1 attempted, stopped on provider rate limit | Incomplete; do not infer accuracy from unattempted cases |

Evidence paths:

- Initial environment diagnosis: `artifacts/qa/2026-09-26T00-56-41-062Z/qa-doctor.md`.
- Desktop doctor and browser report: `artifacts/qa/2026-09-26T00-59-11-182Z/`.
- Corrected entitlement/feedback browser checks: `artifacts/qa/2026-09-26T01-04-08-016Z/report.md`.
- Mobile checks: `artifacts/qa/2026-09-26T01-10-50-699Z/report.md`.
- Each browser folder contains screenshots, HTML, trace and video evidence.
- Full local lint/test log: `artifacts/qa/2026-09-25-release-check.log` (build completed in a separate verified invocation).
- Completed blocked eval report: `.deepspec-eval/identify-summary.json`; terminal evidence: `artifacts/qa/2026-09-25-identify-release.log`.

## Open-issue assessment

This is a current-state assessment of all 16 issues returned by GitHub, not a claim that all acceptance criteria passed.

| GitHub issue | Current assessment / next action |
| --- | --- |
| #57 anonymous auth/cloud sync | Historical anonymous-auth failure no longer reproduces locally. Standard cloud verifier passes; CI evidence still needs to be checked before declaring the whole ticket complete. |
| #58 Actions configuration | Confirmed still blocked in run 36207815738: both public Supabase Actions secrets are missing. |
| #59 300-case eval harness | Public 300-case command and summary gate exist; completed live public-quality evidence remains separate. |
| #60 candidate promotion | Current simplified result has feedback/inspection, not the ticket's full source-backed alternative-promotion UI. Product backlog, not fixed by changing a selector. |
| #61 durable dataset tables | Standard hosted detail-table/private-image isolation is freshly verified. Inspection is a separate missing migration. |
| #62 browser QA matrix | Repeatable desktop/mobile scenarios exist and were exercised. Live email/OAuth, physical camera and full live chat remain unverified. |
| #74 reusable release branch | The existing #114 branch has received many updates; retain one active integration PR. Older conflicting PRs require explicit reconciliation, not repeated replacement branches. |
| #87 Lens result hardening | Result/mobile flows work, but old tab/candidate designs differ from the current simpler interface. Exact source ranking and fitment remain unproven. |
| #88 internal review dashboard | History filters exist; a distinct authorized cloud review dashboard remains unimplemented. Do not expose other users' scans to create a dashboard. |
| #89 blurry-label OCR fixture | No fresh real blurry-label OCR evaluation was established in this audit. Keep OCR claims limited. |
| #90 public 300-case run | Requires completed provider/quality evaluation, separate from component tests and the beta gate. |
| #106 missing auth/tables/storage | Old blocker no longer reproduces: standard hosted nine-step verifier succeeds today. |
| #115 real phone QA | Still requires physical camera, permissions, glare/low-light and network evidence on an HTTPS deployment. |
| #116 billing sandbox | No provider configured; current code supports Polar and legacy Stripe. Owner must choose/setup the intended sandbox; do not invent product IDs. |
| #117 AI reliability | Earlier one-sample provider health and real engine scan passed, but the restarted 50-case run hit rate limiting on its first sample. Release remains blocked. |
| #118 paid go/no-go | Remains blocked by incomplete phone, inspection, credential and billing evidence. A code merge does not authorize paid launch. |

Issue links follow `https://github.com/om1o/DeepSpec/issues/<number>`.

## What still needs access or human evidence

- Deploy `supabase/migrations/20260920000100_part_inspection.sql` through the existing database process, then run `npm run verify:supabase -- --inspection`. No database deployment credentials were present. The connected browser could not attach a Supabase dashboard tab, so no database change was attempted. Likely change: hosted schema, not another React patch. CI currently verifies standard persistence; add the inspection gate when rolling out that feature.
- Use a dedicated test account and inbox to prove real password/code delivery. Do not commit those credentials. Relevant verifier: `scripts/verify-auth-flows.mjs`.
- Finish physical-phone QA and sandbox billing evidence. Relevant runbooks: `docs/DAD_PHONE_PAID_BETA_RELEASE.md`, `docs/POLAR_TESTING_ONLY_SETUP.md`.
- Multi-device saves remain last-write-wins. Before automatic replay/shared-shop editing, add revision checks and conflict recovery to `src/services/cloudSync.ts` and its server schema.

## What to improve next

My recommendation is a narrow intake experiment: one willing starter/alternator seller, ten observed manual items and then twenty comparable scans. Record active minutes, wrong identifications, corrections and missing information. Keep part identity, fitment and functional checks human-confirmed. The hypothesis is that documenting an incoming part becomes faster; this has not been measured with a customer.

Priorities are (1) reliable inspection persistence, (2) real-phone usability and latency, (3) identity/error measurements for one part family, and (4) a buyer deciding whether repeated use is worth paying for. Use an agreed improvement target before the experiment; do not turn a proposed price or target into a claimed result.

I would defer more 3D features, automated training and a larger dashboard until observation shows they solve the main bottleneck. A beautiful interface helps testing, but it cannot replace evidence that the tool saves work. No business valuation or willingness-to-pay conclusion follows from the engineering tests.
