# Human inspection: first pilot increment

DeepSpec now lets a person record an inspection on a saved scan. Open a result
from History, expand **Human inspection**, enter the checks performed and an
inspector name, then select **Save inspection**. The text report includes the
inspection separately from the AI answer.

Identity and part number require supporting evidence. Visible damage and
uncertainty require notes. A functional-test outcome requires a test method and
result. Defaults are **Not inspected** and **Not tested**; appearance never
establishes function. Inspector names are self-reported, not authenticated
signatures or certifications.

## Persistence and rollout

- Local saves preserve the AI result, feedback and training labels.
- Open forms check for changed or deleted device inspections before saving, and for newer inspection props supplied by the parent. A conflicting draft stays visible for copying and review. This prevents known stale-form overwrites; it is not an atomic lock across tabs or devices.
- Edited forms show **Unsaved inspection changes** and offer **Download draft**. This recovery text includes incomplete inputs without pretending they passed validation or were saved. It does not sync, certify the part, or replace a completed report. Keep the page open until you have saved or downloaded the draft; drafts are not automatically restored after closing it.
- Inspection does not grant training consent or automatically train a model.
- Configured cloud sync stores a separate `inspection_json` field. Cloud-only
  scans use an owner-scoped metadata update without reuploading signed images.
- Apply `supabase/migrations/20260920000100_part_inspection.sql` through the
  project's normal database deployment process before expecting cloud writes.
  This migration has not been applied by this implementation task.
- Older database schemas remain readable. Missing migrations cause an explicit
  sync failure; the locally saved inspection remains available.
- Cloud writes remain last-write-wins. Concurrent inspection editing, version
  history, and conflict resolution are not implemented. History chooses the
  newer inspection timestamp when combining a local and cloud copy.
- Within one running app, a scan's cloud retry waits for an earlier request to
  settle, including after the 20-second confirmation timeout. Timed-out work
  cannot start later writes, but a request already sent can still complete.
  A request that never settles keeps that retry blocked. Keep the device copy
  and export it; a timeout is not confirmation of backup or cancellation.
- Reloading cloud history can refresh an expired photo URL while preserving
  device photos and human notes. An already-open result does not automatically
  renew its signed URL; return to Saved scans to fetch fresh cloud history.

## What this increment does not prove

It does not add 3D measurement, identify hidden failures, certify a part, license
a parts catalog, or establish model accuracy. Automated cloud tests use mocks;
live database/RLS verification is still required after migration deployment.

## Inspection-cloud release check

Run `npm run verify:supabase -- --inspection` after deploying the existing inspection migration through the normal process. This command does not deploy SQL or change policies. It uses public credentials and isolated anonymous QA accounts, leaving browser sessions untouched.

The command first authenticates and probes `inspection_json` before writing scan/image fixtures. Missing schema is an explicit blocker with a nonzero exit. Once available, it writes and updates synthetic inspection evidence, reads it back, checks that AI results, notes, chat, feedback and image metadata are unchanged, then proves a second account cannot read or alter the fixture. Ambiguous network/auth errors do not count as successful isolation.

Both this mode and the ordinary `npm run verify:supabase` now check cleanup of generated rows and images before reporting final success. Cleanup targets only the generated fixture IDs and paths. Temporary anonymous auth accounts remain because public credentials cannot delete auth users. Each verifier HTTP request has a 20-second deadline and preserves caller cancellation. Total runtime also includes SDK retries and fixture cleanup. This gate does not establish shop-member sharing permissions, inspector identity certification, concurrent-write resolution, or broader model accuracy.

September 20 evidence: 27 helper tests passed. The live inspection mode exited 1 at the missing-column preflight before fixture writes; inspection cloud save/read remains unverified. The ordinary cloud verifier passed with checked cleanup. Local evidence is in `artifacts/qa/inspection-cloud-2026-09-20/inspection-preflight.txt` and `baseline-checked-cleanup.txt`.

## Next pilot experiment

Use the concrete readiness checklist, recruitment draft and timing protocol in [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md). The trial has not been recruited or run yet.

September 25 follow-up (September 26 UTC): two stale-form regressions failed before the guard and passed afterward. The form, storage, cloud sync and pilot-summary suites passed 105 tests; lint and the production build passed. Live inspection verification still stopped at the missing-column preflight, without scan/image fixture writes. Cloud-backed seller work remains blocked on deployment and successful live verification. Simultaneous cross-tab writes and cross-device edits still require server-side conflict protection; the form guard does not solve those races.

September 26 draft recovery: 70 form/storage/report tests, lint and production build passed. QA doctor passed, followed by mobile-emulated auth and result-detail checks with an actual draft download and an unobscured-warning check. Evidence: `artifacts/qa/2026-09-26T09-33-21-415Z/report.md`, `inspection-draft.txt`, and `screenshots/inspection-draft-recovery.png` in that folder. No seller data or live inspection write was used for these browser checks.

Recruit one parts business and select one part category together. Have staff
record the existing identification/documentation time, then repeat with
DeepSpec. Record correct identity, unresolved cases, wrong confident answers,
documentation completeness, and time per part. Use different physical parts
for evaluation and any later training, with explicit permission for reuse.
Use measured results and willingness to pay to decide the next feature.
