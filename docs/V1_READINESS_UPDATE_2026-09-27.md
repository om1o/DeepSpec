# V1 readiness follow-up

The project owner confirmed that no domain has been purchased yet. Domain setup and public promotion come after V1 works reliably. Local verification is useful but is not a deployed-app test.

## Fixed

- Removed automatic cloud re-identification on authenticated startup and reconnect. A saved offline estimate no longer triggers potentially billable inference simply because the app opens or the network returns. The explicit upgrade function remains, with no automatic caller.
- Manual saved/unsaved retries and explicit offline upgrades now pass stored vehicle context and apply Scanner's existing fitment safeguards. Unsaved retry context survives a later save.
- An offline upgrade is counted only when its replacement result actually saves successfully.
- Fixed unreadable dark-on-dark Shop headings using the page foreground colors. Browser measurements: heading 20.16:1 and organization name 15.51:1; dark text inside white cards remains unchanged.
- CI accepts the public Supabase URL/key from either repository secrets or variables; existing secrets take precedence. Missing settings still fail main-bound pull requests. The YAML and both required gate branches were checked.
- Reproduced a real engine-upload stall in a stable local build: optional MVANet CPU/WASM initialization delayed the AI request until nearly the 90-second watchdog. The API then returned HTTP 200 in 6.6 seconds, but the screen showed a stalled scan. Background removal now requires WebGPU (including warm-up); unsupported/failed GPU paths use the existing crop/full-photo fallback. A bounded GPU probe and limited pre/post-result visual work prevent optional promises from holding up identification and saving. Timeouts ignore late visual values rather than cancelling every GPU operation.

## Evidence and limits

- Current published CI run `36323114628` passed lint/tests/build but failed at auth configuration: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` were absent. Its cloud-sync check did not run. [Settings instructions](CI_SETUP.md) describe the owner action; connected tools cannot set these settings in this session.
- Local auth-provider verification passed; password login, email-code delivery and recovery were not established because dedicated credentials were not provided. Log: `artifacts/qa/launch-2026-09-27/auth.txt`.
- One-image provider health check passed, returning a Front Bumper suggestion in about 6.1 seconds total. This is connectivity evidence, not an accuracy evaluation. An extra fallback attempt logged a network error while the successful primary result remained available. Evidence: `artifacts/release-gates/provider-health-summary.json` and `artifacts/qa/launch-2026-09-27/provider-health.txt`.
- Focused retry/startup validation passed: 98 tests across App, offlineUpgrade, Result and Scanner; TypeScript and selected-file ESLint passed.
- The broader test run had 1,091 passing tests and one stale CI-warning assertion. That assertion was updated for variables/secrets support without weakening the required gate; its seven-test suite passed on rerun. Full lint passed. Logs: `artifacts/qa/launch-2026-09-27/check.txt` and `ci-test.txt`.
- Mobile browser QA initially passed 19 scenarios, with an engine reload interruption and stale shop privacy-copy assertion. The assertion now checks the real default-off control and no-automatic-training explanation and explicitly does not claim to verify organization database permissions. Corrected Shop/auth/privacy checks passed at `artifacts/qa/2026-09-27T15-04-57-840Z/report.md`; screenshots/trace/video are in that folder.
- The stable-build stall reproduction is recorded at `artifacts/qa/2026-09-27T15-05-31-575Z/report.md` with its screenshot and network trace. The evidence points to optional frontend preparation, despite the generic QA report labeling the missing-result outcome backend. No API failure is inferred from that label.
- Stall regression tests passed: 77 tests across Scanner, productSegmentation, WebGPU, promptableSegmentation and on-device identification, plus TypeScript. They cover never-resolving visual preparation, post-result work and debug GPU checks, ignored late results, no-GPU warm-up/scan behavior and GPU initialization failure without CPU fallback.
- After the fix, production build and selected ESLint passed. The same engine fixture passed in the built app: scanner controls 984 ms, upload/AI result 5,818 ms, HTTP 200, and visible **Scan saved to cloud**. Doctor and real no-email auth passed. Final evidence: `artifacts/qa/2026-09-27T15-15-45-563Z/report.md`, with screenshot, trace and video. This demonstrates one test flow, not general accuracy or latency. The original 19 passing browser scenarios and targeted fixes are separate runs, not one claimed all-green full run.

## Prepared for later

[Launch-content drafts](V1_LAUNCH_CONTENT_DRAFTS.md) include positioning, SEO title/description, organic posts, a real-demo script and two ad variants. Nothing was posted and no advertising spend was started. Existing placeholder-domain SEO files were intentionally left unchanged until a real production origin is chosen.

Next external gates: owner configures GitHub public settings; a dedicated account verifies email/password/recovery; actual phones exercise capture/save/reopen; one seller tests usefulness and time taken. Hosting and domain choice then allow deployed verification and final SEO URLs. Optional billing/shop review findings remain separate gates before those features are enabled.

## September 29 handoff check

PR #114 remains open at code head `809645840dccb3e69cf32d7c64d1c71b2b0504a8`. Its [CI run 36329077468](https://github.com/om1o/DeepSpec/actions/runs/36329077468) completed: lint, all **1,101 tests across 81 files**, and build passed. The overall quality job failed because the public Supabase settings were still missing; auth verification did not execute its verifier and cloud sync was skipped. This supersedes the earlier incomplete full-suite evidence for that code head, but does not establish cloud CI readiness.

The user authorized a merge. It was deferred because the quality gate remains failed, not because merge authorization is missing. The available connected GitHub tools do not expose a repository variable/secret setter. Complete [CI setup](CI_SETUP.md), rerun the current head's checks, and resolve material review findings before merging. No public deployment is implied by a future merge.

The code was already committed and the local/remote trees matched before this documentation change. The [Claude continuation prompt](CLAUDE_V1_CONTINUATION_PROMPT.md) records the completed steps, verification limits, safe Git handoff and next operational-visibility/camera/trial work.
