# V1 foundation changes — September 26, 2026

## Outcome

Completed the first foundation slice of the [V1 launch plan](V1_LAUNCH_PLAN.md): live inspection persistence, easier reporting, feedback ownership, safer production rate limiting, and truthful data-use wording. This is not a completed public launch or a completed training-data platform.

## Verified changes

- Applied the existing additive inspection migration to the configured live `deepspec` Supabase project. Live owner save/read/update, unchanged original evidence, non-owner read/write denial and private-photo isolation passed. Generated scan/image fixtures were removed; temporary anonymous auth accounts remain because the verifier uses public credentials.
- Added 18 specific result/AR/bug/feature reasons and a result-page report link. A quick report can omit an explanation. The scan ID and prediction are unchecked by default and included only with explicit selection; no photo/chat is attached. Pending duplicate submission is blocked, and failed delivery retains a truthful device-only message.
- Reused existing feedback infrastructure. Issue/context are typed locally and encoded in a bounded versioned cloud message. This is a compatibility bridge, not queryable remote review columns or a finished internal dashboard.
- New feedback rows default to the current authenticated owner. RLS rejects a supplied different owner and still allows logged-out null-owner submissions. Existing reports were not rewritten.
- Applied the existing server rate-limit migration. Live privilege testing caught explicit `anon`/`authenticated` EXECUTE grants inherited from database defaults despite the old migration revoking PUBLIC. A new additive permissions migration removes these grants from both limiter functions. Browser table access is denied; service execution and the threshold test pass.
- Production API calls now return retryable 503 when the rate limiter cannot verify limits, including missing credentials/IP, malformed replies and thrown failures. Development remains usable without the database limiter. This intentionally trades temporary availability for protection against unbounded paid inference. Deployment still needs correct environment and trusted proxy headers.
- Replaced “learned from corrections” copy with “available for review” and made its device-local limitation explicit. README no longer treats all scans as training data.

## Live migration ledger

Project: `tvmomaxmiecguqikpckb` (matches local configured URL), reported ACTIVE_HEALTHY. Only the following scoped migrations were applied; unrelated billing/shop migrations were not deployed.

| Repository SQL | Live version | Result |
| --- | --- | --- |
| `20260920000100_part_inspection.sql` | `20260926185704` / part_inspection | Applied; round-trip verified. |
| `20260926190227_feedback_ownership.sql` | `20260926190325` / feedback_ownership | Applied; owner/default/spoof/isolation tests passed. |
| `20260707000100_rate_limit_hits.sql` | `20260926190326` / rate_limit_hits | Applied; original execution grant flaw found and fixed below. |
| `20260926190422_restrict_rate_limit_execution.sql` | `20260926190444` / restrict_rate_limit_execution | Applied; browser access denied, service access retained. |

The connected migration tool records execution-time versions, which differ from repository filenames. Reconcile this ledger before a future CLI `db push`; do not blindly deploy every pending migration. Roll back application behavior if necessary while retaining stored inspection data; do not drop columns or records to roll back the UI.

## Validation

| Check | Result / evidence |
| --- | --- |
| `npm run check` | Passed: lint, **77 test files / 1,035 tests**, TypeScript and build. Existing >500 kB bundle warning remains. Log: `artifacts/qa/v1-foundation-2026-09-26/check.txt`. |
| Live inspection verifier | Passed: `npm run verify:supabase -- --inspection`. Log: `artifacts/qa/v1-foundation-2026-09-26/cloud-inspection.txt`. |
| Live SQL regression | `supabase/tests/v1_foundation.sql` executed successfully through connected tooling. Tests owner default, spoof denial, cross-account read denial, logged-out insert, server-only limiter privileges and allow/deny threshold. All generated SQL fixtures roll back. |
| Mobile critical flows | Doctor passed, then no-email login, inspection recovery and early-access checks passed at 390×844 on current source. `artifacts/qa/2026-09-26T19-09-04-478Z/report.md`; screenshots/trace in that directory. Browser cloud failures deliberately intercepted; live persistence is established by the separate verifier. |
| New feedback browser flow | Passed real no-email login, result link, context opt-in/off, AR/wrong-part report, pending duplicate prevention, failed-cloud local status, and 390/1440px layouts. `artifacts/qa/v1-foundation-2026-09-26/feedback-browser-report.json`; `feedback-mobile.png`, `feedback-desktop.png`. Both feedback POSTs intercepted, no real reports submitted. |
| Email/password verifier | Blocked by missing `DEEPSPEC_AUTH_TEST_EMAIL` / `DEEPSPEC_AUTH_TEST_PASSWORD`. Live settings/signup/anonymous auth passed. `artifacts/qa/v1-foundation-2026-09-26/auth.txt`. No claim of email delivery or recovery. |
| Initial local environment | Port 3000 was not running. Doctor classified stale environment; new source server on 5176 passed doctor. This was not an app bug. |

Security advisors after changes report expected anonymous-session access warnings on owner-scoped tables, intentional no-client-policy informational notice for the server-only counter table, and **leaked-password protection disabled**. Owner isolation was tested; anonymous authentication is an intentional no-email access mode, not public access to other users' scans. Review [anonymous-session advisor guidance](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins), [server-only RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) before public launch. No billing plan or paid security option was changed.

## Presentation

- [Full editable 18-slide PowerPoint](presentations/DeepSpec-Full-Product.pptx), [presenter notes](presentations/DeepSpec-Full-Product-Notes.md), and [interactive presentation](presentations/DeepSpec-Full-Interactive.html).
- Product purpose, real app screenshots, human inspection evidence, storage boundaries, buyer hypotheses, hypothetical labor model, V1/V2 boundaries and the one-month plan. No invented customer, accuracy or savings results.
- PowerPoint: 18 rendered/reviewed slides, three native tables, native chart with embedded workbook, structural and layout checks passed with zero findings. Native PowerPoint opening not tested. Evidence: `artifacts/pilot/product-presentation/pptx/build/validation-v3.json` and `visual-review-v3.json`.
- Interactive: all 18 sections at 1440/390/320px, navigation, roles, tour, recovery/stale simulation, and default/zero/negative calculator outcomes passed without JS errors or document overflow. Evidence: `artifacts/pilot/product-presentation/interactive-qa/report.json`. Self-contained HTML makes no customer-data connection.
- Uses existing DeepSpec logo and original generated illustrative artwork; QA screenshots contain test fixtures. Source template/assets are under `docs/presentations/full-product/`; rebuild with `node docs/presentations/full-product/build-interactive.mjs`.

## Remaining launch gates

Durable per-scan training consent/revocation and dataset lineage; internal review; stable model-run identity/version; centralized operational visibility; email auth and final deployed configuration; provider evaluation; physical-phone AR/camera validation; 5–15-user observation. Public feedback abuse controls and retention/deletion remain necessary. Paid launch additionally needs billing/concurrent-credit checks. Current captured-image highlighting is not proof of stable live spatial AR.

The next engineering slice is durable consent and a small review queue, with defaults that forbid training until permission and verification are present. Keep the [launch plan](V1_LAUNCH_PLAN.md) as the execution checklist rather than adding speculative V2 features.
