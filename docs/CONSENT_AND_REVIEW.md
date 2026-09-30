# Scan consent and internal review

September 27, 2026. This foundation slice of [V1](V1_LAUNCH_PLAN.md) provides durable consent and a small administrator workflow. The separate [dataset workflow](DATASET_LINEAGE.md) builds on it; no model training runs automatically.

## User experience

Saved results contain **Help improve DeepSpec — optional**. Consent is off until the user explicitly selects the checkbox and saves successfully to the cloud. Missing rows mean no consent. Product storage, a thumbs-up, a correction, and the older local shop preference do not grant this permission.

Consent covers the scan photo, analysis and corrections for reviewed future model improvement under policy `2026-09-27-v1`. The policy text/version is a product control, not a substitute for public privacy/terms review. Scanning does not depend on opt-in. The user can withdraw from the same panel. A scan must exist in their cloud history before a choice can be saved. A local-only scan cannot silently become a training example.

Cloud confirmation is required. Failed, timed-out or conflicting writes show uncertainty and require reloading status. Aborting a client request does not guarantee that the database rolled it back. The component does not use device storage as the authority. Account-generation checks reject stale asynchronous responses after account changes.

Updates compare the revision last read. A stale tab cannot overwrite a withdrawal using the old revision. Concurrent first-time inserts conflict instead of blindly upserting. A direct malicious client can still change its own consent, as intended; revision comparisons protect the application workflow rather than imposing a lock on the owner.

## Data and permissions

| Object | Browser permissions | Purpose |
| --- | --- | --- |
| `scan_training_consent` | Owner select; insert ownership/choice/policy; update choice/policy only | Explicit permission, server timestamp and revision. No user-supplied verification. |
| `scan_training_reviews` | None | Administrator candidate/verified/approved/rejected decision, human verification, reviewer, notes and reviewed snapshot. |
| `feedback_reviews` | None | Administrator new/reviewed/confirmed_issue/fixed state and notes. |
| `feedback_review_queue` | None | Existing reports joined with current review state; unreviewed reports appear as new. |
| `scan_training_review_queue` | None | Consent and review state with a live readiness-for-dataset-review calculation. |

All tables use RLS and explicit grants. Views use `security_invoker=true` and are granted only to `service_role`; use an administrator SQL session or a trusted server, never expose a service key to a browser. The consent timestamp trigger is security-invoker in the private schema and cannot be invoked as a browser RPC.

The ownership foreign key references `(scan_lookups.user_id, local_id)`. Deleting a cloud scan cascades to its consent and training review. Deleting only a device copy does not delete its cloud record or revoke cloud consent. Deleting a feedback report removes its review. Account deletion follows the existing scan ownership cascade. Existing scans are not backfilled with consent.

## Minimal internal review workflow

Use the connected Supabase SQL Editor with administrator access. No new public admin route or shared admin password is introduced. Do not add browser permissions to these queues to work around access failures.

1. Read only the needed reports:

```sql
select id, created_at, category, message, review_status
from public.feedback_review_queue
where review_status <> 'fixed'
order by created_at
limit 50;
```

2. Reproduce the report. Update a single known report using its actual ID and your reviewer reference. Keep sensitive details out of notes. The ID below is a placeholder, not an instruction to review arbitrary reports:

```sql
insert into public.feedback_reviews(feedback_id, status, reviewer_reference, notes)
values ('REPLACE_WITH_REPORT_UUID'::uuid, 'reviewed', 'REPLACE_WITH_REVIEWER', 'Reproduction evidence and next action')
on conflict (feedback_id) do update
set status = excluded.status, reviewer_reference = excluded.reviewer_reference,
    notes = excluded.notes, reviewed_at = now();
```

Move through `new → reviewed → confirmed_issue → fixed` as evidence supports it. Reopen to reviewed if a supposed fix fails. These are current-state records, not a full immutable event log. No historical report is automatically labeled a confirmed bug.

3. For training review, start with current opt-ins:

```sql
select user_id, scan_local_id, revision, policy_version, current_scan_hash,
       review_status, human_verified, ready_for_dataset_review
from public.scan_training_review_queue
where training_consent
order by consent_updated_at
limit 50;
```

Review the actual photo, original prediction, correction, privacy, rights and label evidence. A user correction is not ground truth. Record the exact revision/hash you inspected; do not automatically fetch the latest hash when approving an older review. For one inspected example:

```sql
insert into public.scan_training_reviews
  (user_id, scan_local_id, consent_revision, reviewed_scan_hash,
   status, human_verified, reviewer_reference, notes)
values
  ('REPLACE_WITH_USER_UUID'::uuid, 'REPLACE_WITH_SCAN_ID', 1, 'REPLACE_WITH_INSPECTED_HASH',
   'verified', true, 'REPLACE_WITH_REVIEWER', 'Evidence supporting the verified label');
```

Use `candidate` with `human_verified=false` until verification is complete. `verified` and `approved` require human verification at the database layer. Approval is still only readiness for dataset review, not permission to skip later export checks. Review updates must name the exact scan and retain the inspected revision/hash; never bulk approve a queue.

## Withdrawal, edits and dataset boundary

Withdrawal makes readiness false immediately in the database. Re-opting in advances the revision, so old approval does not reappear. Changed scan metadata invalidates the reviewed fingerprint; ordinary `synced_at` refresh alone does not. The displayed review status may still be approved as a historical current-state label, while `ready_for_dataset_review=false`. Always use current readiness and permission, not status alone.

The fingerprint covers `scan_lookups` metadata, including its recorded image hash. It does **not** verify current Storage bytes or all child tables. Storage paths can be overwritten. The separate administrator exporter fetches and hashes actual image bytes, checks current eligibility again, and records versioned membership. Human privacy/rights/quality review remains required. Queue readiness alone never authorizes an export.

A withdrawal cannot promise to undo training already completed. Versioned membership now supports exclusion and source-deletion cascades, but previously copied exports need explicit purging. A complete immutable consent event history is not implemented. See the dataset operator instructions for these boundaries.

## Verification

Run `supabase/tests/scan_training_consent.sql` with an administrator SQL connection. It creates isolated fixtures, asserts permissions/defaults, stale-write denial, withdrawal/re-opt-in invalidation, scan edits, feedback review progression and cascade deletion, then rolls back. It must succeed without suppressed exceptions. Browser verification additionally exercises actual PostgREST grants and durable reload behavior.
