# Inspection draft recovery and private-beta readiness

September 26, 2026. Implemented for review on the existing integration branch.
No main merge, database migration or production deployment was performed.

## Result

Unfinished human inspection fields are copied synchronously to this account's
device storage as they change. Reopening the scan announces a draft and requires
an explicit restore or discard. The saved inspection remains visible and unchanged
until the user saves a valid inspection. Incomplete text, whitespace and untested
status survive recovery without being treated as completed evidence.

Recovery is tied to the saved inspection present when editing began. A newer or
removed device inspection blocks stale saving/restoring. A stale recovery copy
can still be downloaded for comparison. Known changes from another tab block
draft replacement/removal. Account changes, including switching away and back,
invalidate an old mounted form's access. A successful local inspection save clears
its matching draft even when cloud sync fails. Removing a device scan also removes
its draft, reports cleanup failures, and prevents the old form from recreating it.

Storage errors leave current text in the form with a warning and an independent
text download. Drafts never enter cloud inspection storage, reports or training
automatically. The existing complete report remains separate from recovery exports.

## Verification

- Reproduced missing refresh recovery first: two new UI tests failed before the
  implementation. Log: `artifacts/qa/draft-recovery-before.txt`.
- Full test run: 76 files, 1,015 tests passed. Includes the existing form/storage
  tests, ten new recovery UI cases and 21 storage/scope/corruption cases.
  Log: `artifacts/qa/draft-recovery-full-check.txt`.
- Lint, TypeScript and production build passed. Final QA script lint was repeated
  after extending the browser quota simulation.
- Mobile (390 x 844): doctor-first auth and inspection recovery passed.
  Report: `artifacts/qa/2026-09-26T16-19-52-794Z/report.md`.
- Desktop (1440 x 900): the same checks passed.
  Report: `artifacts/qa/2026-09-26T16-20-49-881Z/report.md`.
- Both browser runs edited offline, reconnected, closed/reopened the tab, restored
  exact incomplete notes, discarded and reloaded, simulated draft storage failure,
  and checked downloaded recovery bytes. They also saved complete device records,
  reloaded all eight fields, checked report bytes, and protected newer two-tab work.
  The old draft remained downloadable after reload with restoration disabled.
  All eight inspection controls passed viewport hit tests.
- Screenshots, traces, videos, JSON assertions and downloaded text files are beside
  each report. Reviewed recovery screenshots; debug diagnostics were enabled in
  this local build. No seller/customer records were used.
- An independent review found the missing device-delete cleanup, which was fixed
  and covered for forms edited both before and after record deletion.

Browser auth used the configured no-email Supabase flow. Cloud inspection writes
were deliberately intercepted with failures. These passes prove device recovery
and failure handling, not live inspection-cloud persistence or email delivery.

## Release boundaries

Read-only inspection schema checking still reports missing `inspection_json`.
[CI run 36255542250](https://github.com/om1o/DeepSpec/actions/runs/36255542250)
on published application commit `8dce4d989be5badcb71e21f13a927be7d36e96e1`
passed lint, all 1,015 tests and build, then failed the auth gate because
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` were unavailable. The cloud
step was skipped. This commit has the same application tree as local `df69695`.
The exact SQL, settings, verification
commands and seller protocol are in
[PRIVATE_BETA_RELEASE_CHECKLIST.md](PRIVATE_BETA_RELEASE_CHECKLIST.md).
Later documentation/presentation commits must retain these gates and identify
their own CI run; they do not change the tested application code.

Draft storage is account-scoped browser storage, not encryption or a cloud backup.
Cleared/evicted storage, browser profiles, physical-device interruption and a fresh
offline app load have separate limits. Failed draft writes can leave an older
recovery copy; download current notes before leaving when warned. Corrupt records
must be explicitly discarded before a new device draft can be kept.

The localStorage comparison is optimistic, not atomic. Simultaneous tab writes
can race, and cloud writes still lack server-side conflict resolution. Keep the
private beta to one editor per inspection. Physical-phone checks, cloud migration
and live inspection read/update/isolation verification remain release gates.

The next business test is one seller, one operator and one part family using
[PILOT_RUNBOOK.md](PILOT_RUNBOOK.md). No measured savings, paying customer, model
accuracy or safety certification is established by this engineering work.
