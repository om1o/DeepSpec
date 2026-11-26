# Reviewed datasets and inference provenance

September 27, 2026. This is a small administrator workflow for the private beta, not automatic training or a claim of model accuracy.

## What is recorded

New successful server and on-device results have an inference ID and prompt/pipeline version. Repeated cloud sync uses the same run key instead of creating another inference. Client request failures have separate attempt IDs and retained error records; retrying a valid result does not erase that result. This does not capture every internal provider fallback. Old records are not assigned invented versions: a `legacy:` digest only deduplicates subsequent syncs of the same historical snapshot. Existing duplicate legacy rows remain historical records, not an inference count.

The original private photo remains `scan_lookups.image_path`. An optional saved crop/segmentation has separate `isolated_image_*` path, SHA-256, MIME and size fields. The derivative is the saved display image, not necessarily the exact second image sent to inference. Neither asset is public. Local failed requests are retained for sync subject to device storage limits; this is not a separate unlimited offline event archive.

## Curate one example

Use an administrator SQL session. Never put a service-role key in React, a `VITE_` variable, source control or a screenshot.

1. Inspect a current opt-in in `scan_training_review_queue`, the original private photo and optional derivative, the original result and correction, and one associated `scan_model_runs` row. Confirm label, image quality, privacy and usage rights. Exclude faces, plates or other personal information unless properly removed and separately reviewed. A correction is a suggestion until verified.
2. Record the exact inspected consent revision and scan fingerprint in `scan_training_reviews` with an approved, human-verified decision, following [the review instructions](CONSENT_AND_REVIEW.md). Record `md5(to_jsonb(m)::text)` for the inspected model-run row. Do not approve a newer fingerprint simply because the source changed while you were reviewing it.
3. Create a named dataset version and one membership using those inspected values. Example placeholders below must be replaced deliberately; do not bulk approve a queue.

```sql
insert into public.dataset_versions(version, purpose, description)
values ('vision-eval-v1', 'evaluation', 'Human-reviewed beta evaluation examples');

insert into public.dataset_members (
  dataset_version, user_id, scan_local_id, model_run_id,
  consent_revision, policy_version, scan_hash, model_run_hash,
  label, label_source, reviewer_reference,
  privacy_checked, usage_rights_checked, quality_checked
) values (
  'vision-eval-v1', 'REPLACE_USER_UUID'::uuid, 'REPLACE_SCAN_ID', 'REPLACE_RUN_UUID'::uuid,
  1, '2026-09-27-v1', 'REPLACE_INSPECTED_SCAN_HASH', 'REPLACE_INSPECTED_RUN_HASH',
  'REPLACE_VERIFIED_LABEL', 'human_verified_correction', 'REPLACE_REVIEWER',
  true, true, true
);
```

Use `human_verified_prediction` when the verified label confirms the original identification. The verified label, original prediction and user correction remain distinct. The true check flags are assertions by the human reviewer, not results of an automated privacy detector.

Human repair and follow-up records are separate from the scan dataset. Per-scan training consent covers the photo, analysis and correction, not service history. A follow-up record has its own optional **outcome evaluation** consent under policy `2026-11-26-v1`. Missing consent is off; the owner can withdraw it from the saved service record. It does not grant training permission. A reported symptom outcome is self-reported, not proof of a permanent fix or a ground-truth part label.

For an outcome evaluation, a curator must first create an eligible `evaluation` membership with either `human_verified_prediction` or `human_verified_correction` as above. A correction-sourced membership must retain nonempty correction text. In an administrator-only session, inspect the selected follow-up and all same-scan service entries, resolve correction forks, confirm the outcome category, privacy and rights, and deliberately choose the exact record and membership IDs. Read its consent revision/policy and the current history fingerprint from the database. Copy the fingerprint actually inspected; never automatically approve a newer fingerprint. Record the decision in `dataset_outcome_reviews` with `status='approved'`, `category_checked=true`, the inspected consent revision/policy/hash and a reviewer reference. The table accepts candidate or rejected decisions; only the approved current decision qualifies. A correction, retraction, other service entry, consent withdrawal or re-opt-in invalidates the old approval. A corrected/retracted selected record cannot qualify even if its old review is refreshed. Browser accounts cannot read or edit this review table.

`dataset_outcome_export_queue` joins that selected record to the human-reviewed identification and checks current scan and outcome consent, record status, review revision and full service-history fingerprint. It exposes only the structured self-reported outcome category, reporting-basis enum and minimal IDs/review provenance to `service_role`. The optional `--with-reviewed-outcomes` exporter mode writes only those outcome rows to a private manifest; it writes no scan or service photos, free-text notes, recorder name, VIN or free-text correction. Existing scan exports remain separate. Both modes recheck eligibility before accepting output. The outcome mode requires one eligible reviewed outcome for every member in the named version, so mixed or incomplete versions are rejected.

Membership and version records reject updates. Revise a decision by creating another version; privileged deletion is available for removal. Deleting the source scan or selected model run cascades membership. Browser users cannot read or modify the dataset tables or export queue.

## Export and withdrawal

The administrator exporter is `scripts/export-reviewed-dataset.mjs`. Supply `SUPABASE_URL` and `SUPABASE_SECRET_KEY` only in the trusted shell, and follow its `--help`. The legacy `SUPABASE_SERVICE_ROLE_KEY` remains a temporary rotation fallback. Use a fresh output directory outside any public hosting folder. No export or model training runs automatically.

For the separate outcome-only manifest, pass `--with-reviewed-outcomes` after the output directory. The manifest uses format version 2 and links each reported outcome to an existing reviewed dataset member by ID. It does not carry the member images or correction text. This mode is for evaluation, not model training or repair certification.

`dataset_export_queue` calculates current eligibility from explicit consent, matching revision/policy, approved human review, unchanged scan and model-run fingerprints, and complete owned image references. Missing consent, revoked consent, changed data and deleted sources cannot qualify. Re-opting in does not resurrect membership based on an older revision.

The selected run must identify the current prediction exactly: its `run_key` must match the result's `modelRun.runId`, or the scan's explicit `analysis_attempt_id` when no server run ID exists. A different successful run from the same scan and any failed run are excluded. `legacy:` snapshots are ineligible even if their hashes and reviews match; obtain new explicit inference provenance and review it before creating a new dataset membership. Do not manufacture a historical run ID to make an old example qualify.

The exporter downloads only private bucket objects, verifies SHA-256 and metadata, re-reads eligibility after downloads and writes a manifest with membership/version, label, model and permission provenance. Storage bytes are checked because a metadata fingerprint alone cannot detect an overwritten object. Crops are optional; if present they must pass the same checks.

An export is a point-in-time artifact. Consent can change after any final check. Keep outputs private, register where copies are used, re-export immediately before evaluation/training, and purge earlier copies after withdrawal/deletion. This implementation does not remotely erase a previously copied dataset or unlearn an already trained model. Dataset versions are not an immutable consent-event ledger. These are explicit operational limits, not promises of automatic deletion everywhere.

## Verification

- `supabase/tests/dataset_lineage.sql`: rollback-only fixtures verify resync deduplication, label provenance, immutability, denied browser access, withdrawal/re-opt-in, model/scan mutation, rejected cross-owner/older/failed/legacy runs, privacy-review checks and source deletion.
- `npm test -- scripts/export-reviewed-dataset.test.mjs`: exporter integrity and current-permission checks with synthetic data.
- `supabase/tests/service_outcome_evaluation.sql`: rollback-only separate-consent, owner isolation, review, withdrawal, correction/retraction invalidation and privacy-projection checks. Apply the new migration to a disposable local database before running it. The synthetic run is not hosted Supabase acceptance.
- Existing consent, cloud sync, scanner/result and inference tests protect product saving and retry behavior.

No real user example is approved by these tests. No dataset accuracy, seller time savings or training improvement is claimed.
