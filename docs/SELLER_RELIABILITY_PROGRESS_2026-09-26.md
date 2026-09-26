# Seller reliability work — September 26, 2026

Goal: improve reliable DeepSpec inspections and Rehearsal inventory review with reproducible evidence. This is an active work log, not release approval or a measured customer study.

## Baseline

- DeepSpec local branch `mechanic-shop-mode`, initial commit `ea457fb`; initially clean working tree. Existing PR #114 targets main from `codex/mechanic-shop-mode`, remote head `dff8ec4160a685682af5fbfb8c8c16d394683bcd`. Histories differ; do not force-push or blindly merge them.
- Local app responds on port 3000. Initial doctor was blocked only by an unset explicit QA URL. With `QA_BASE_URL=http://127.0.0.1:3000`, doctor passed in `artifacts/qa/2026-09-26T11-11-31-452Z/`; baseline browser run passed 20 scenarios and reported one scanner failure.
- Remote baseline CI run `36233198171` failed at `scripts/qa/real-website-tester.mjs:758`: undefined `document` in a browser callback. Fixed by using the evaluated element's `ownerDocument`. Cloud gates had not run.
- Rehearsal source located at `C:/Users/omiol/Documents/Codex/2026-09-21/files-pasted-by-the-user-the/outputs/rehearsal`; existing Sites project `appgprj_6ab127b9eb688191b003a780407ced60`. No replacement project or production deployment planned.

## Work plan and acceptance checks

1. Reproduce and fix cloud-save timeout/retry races. A timed-out operation must not continue into subsequent writes or overlap a retry that can be overwritten by the older request. Local data remains available and cloud status is honest.
2. Reproduce and fix stale signed image URLs in saved history and result detail. Fresh cloud images should display while durable local photos and human metadata remain intact.
3. Inspect Rehearsal baseline and implement explicit grouped formatting review if absent. Preserve protected values, source file, row order, and version checks; verify actual CSV bytes and UI.
4. Run focused regressions, final lint/tests/build, doctor-first browser QA, and live inspection preflight where available. Separate synthetic, live service, and physical-device evidence.
5. Update pilot/demo instructions only where behavior changed. Commit and publish verified scoped work for review; do not merge or deploy production changes.

## Boundaries and remaining evidence

- Hosted inspection migration, provider availability, account isolation and CI are being rechecked; old blockers are not assumed resolved.
- No customer trial, time savings, willingness to pay, physical-phone evidence, model training, or production rollout is established by this work.
- Keep raw logs/screenshots/downloads in ignored artifact directories. Record final results and exact resume steps here before handoff.

## Verified implementation milestones

- Four timeout/overlap reproductions failed before the fix (`artifacts/qa/cloud-timeout-before.txt`). Cloud saves now keep a per-account/per-scan in-flight lock through underlying settlement; timed-out work cannot start later writes. Requests already sent can still finish. A pending request that never settles continues blocking same-context retry; cross-tab/server ordering is not solved.
- Focused cloud/form tests passed 52 tests; two additional late-rejection/account-round-trip regressions brought the cloud suite to 36 passing tests. Independent review found no blocker in the scoped locking behavior.
- Three signed-image regressions failed before fixing History/Result merge behavior. A newly fetched cloud URL now replaces a stale URL without replacing a durable local data image or human metadata. History/Result tests passed 60 tests. Long-open/direct result pages still need a fresh history fetch to renew an expired URL.
- `npm run check` passed lint, 982 tests in 74 files, TypeScript and the production build. Log: `artifacts/qa/seller-reliability-check.txt`. Existing large-chunk warnings remain.
- Inspection live preflight (`artifacts/qa/inspection-preflight-2026-09-26.txt`) still fails because `inspection_json` is missing. It stopped before scan/image fixture writes. Existing migration reviewed; no production schema or policy change was applied.
- Development scanner trace shows a document reload while preparing the image, before identification. The old QA report incorrectly called this a backend failure. QA now recognizes an interrupted document separately; final browser verification uses the built app at `http://127.0.0.1:5175` via the existing production QA server.
- Built-app browser run `artifacts/qa/2026-09-26T11-32-46-896Z/` passed 20 flows; engine identification returned HTTP 200 in about 32 seconds and the screenshot shows cloud acknowledgement. QA nevertheless reported missing status because it truncated the page before the notice. Fixed the checker to read the save-status notice itself. This was a test defect, not a missing product badge.
- Corrected browser run `artifacts/qa/2026-09-26T11-35-19-272Z/report.md` passed all five selected checks: live anonymous auth, engine identification (HTTP 200, about 27 seconds) plus scan sync, failed-upload retention/reload followed by explicit successful cloud retry, account switching without device-record exposure, and session restoration without automatic uploads. This is basic scan persistence evidence; human-inspection cloud persistence remains blocked.
- Rehearsal source commit `5653090bfa4c99640e4db1d7b75cf13200439f7e` is pushed to its existing private Sites remote on `codex/grouped-format-review`, with matching remote SHA and a clean worktree. All 37 domain/service tests, lint/typecheck/build, five synthetic workloads, nine browser checks, actual original/reviewed/revoked CSV bytes and 500-row layouts passed. Root visually reviewed the 390px and desktop dialogs. The public site is unchanged; there is no GitHub PR for this separate private source repository.
- New optional `inspection-save-recovery` browser scenario verifies invalid-input rejection, exact device-save/reload fields after controlled cloud failure, completed-report bytes, two-tab stale-form protection and recovery-draft bytes. Earlier failures were selector mismatches, corrected against the UI. Root visual review then found the sticky result summary covering form fields; `artifacts/qa/2026-09-26T11-41-29-200Z/` reproduced four obstructed field centers with viewport screenshots.
- Removed only the result summary's sticky positioning. Focused Result tests passed 32/32 and the rebuilt app passed inspection recovery on mobile (`artifacts/qa/2026-09-26T11-42-57-289Z/report.md`) and desktop (`artifacts/qa/2026-09-26T11-43-30-299Z/report.md`). All eight inspection controls passed the scrolling hit-target check. Exact downloaded report and stale-draft bytes passed; all cloud inspection writes were deliberately intercepted, so this does not verify the missing live schema. Root visually inspected the final screenshots.
- Final `npm run check` passed on all app/QA changes: 74 files, 984 tests, lint, TypeScript and production build (`artifacts/qa/seller-reliability-final-check.txt`). Only the existing large-bundle warning remains. Repeated full checks stopped after this final pass.

## Commit and release status

- DeepSpec verified changes are in local commits `bbdb803` and `cdfd0e2`, published as remote commit `41fff0298d8fec1f5a8c74b3873a69b5066e2427` on `codex/mechanic-shop-mode`, attached to [PR #114](https://github.com/om1o/DeepSpec/pull/114). Local and remote baseline trees matched; GitHub received the verified final tree with the existing remote parent and a non-forced fast-forward update. Fetch and diff verified the published files exactly match. Both histories are retained. A final documentation-only follow-up records these results.
- Native Git push could not authenticate without prompting. The already connected GitHub plugin successfully published the same tree instead. No credentials were printed or stored in source. Neither main nor production was changed.
- No `supabase`, `docker`, or `psql` executable was available for an isolated local migration run. The existing migration adds one nullable object-valued JSONB column and preserves current ownership/shop policies. It has not been applied or executed locally by this task.

## Remaining rollout steps

1. Through the normal owner-controlled database process, apply `supabase/migrations/20260920000100_part_inspection.sql`, then run `npm run verify:supabase -- --inspection`. Require full fixture read/update/isolation/cleanup success before a cloud-backed inspection trial; do not treat the present missing-column preflight as a pass.
2. Resolve fresh PR CI findings and verify the tested head before merging. Do not bypass the existing auth/cloud gates.
3. Use the actual intended phone for the saved-inspection steps in `docs/PILOT_RUNBOOK.md`. Browser mobile emulation does not test its camera, storage pressure or operating-system interruptions.
4. Review and publish Rehearsal separately through Sites, then verify hosted auth and a second authorized account. Source push is not deployment.
5. Recruit one seller/one part family using the existing pilot packet and record every attempted observation. No customer trial, measured labor saving or willingness to pay exists yet.

## Five-minute fictional demonstration

- Open DeepSpec's local built preview at `http://127.0.0.1:5175/`. Sign in, upload `public/test-fixtures/engine-scan-test.jpg`, inspect the suggested identity and cloud status, and open its intake draft.
- Expand Human inspection. Keep unverified identity blank, record an explicitly fictional inspection note and inspector name, and leave function Not tested. Save, reload, then export and compare the exact note and untested label. The current missing cloud inspection schema should leave a device copy with an explicit cloud error; retain the export.
- Open `http://localhost:5173/?run=915cda83-a36e-4340-a187-2158610a3f5d` in the Rehearsal local preview using its existing development sign-in. Inspect the synthetic 500-row group, confirm approval, reload, download original/reviewed copies, and revoke from Approved before downloading again. Compare the description changes and unchanged IDs/quantities/prices. This is a local demonstration, not customer evidence.
