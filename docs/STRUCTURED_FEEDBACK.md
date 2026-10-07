# Structured feedback reports

The September 27 migration adds nullable `issue_code`, `scan_local_id` and `reported_prediction` fields. The 18 issue codes match the application's allowlist. Prediction context is limited to 160 characters. Existing report messages remain unchanged, including the versioned text envelope.

Scan context is shared only when the user explicitly checks its box. The client verifies the current account's cloud scan before attaching a structured link. Device-only context is sent as opted-in text and the user sees that it is not linked to a cloud record. Failed ownership lookup prevents an unconfirmed send. No photo, chat transcript, token or session metadata is attached automatically.

The composite foreign key requires the linked scan and report owner to match. Anonymous reports remain supported but cannot link a scan. Deleting a scan clears the link; deleting its account clears owner and link. Historical prediction text remains as report context, not a verified label or permission for training. A broader feedback deletion/retention workflow is still a launch gate.

`feedback_review_queue` preserves its original columns and appends the issue, owner, scan link and reported prediction. It remains a security-invoker view restricted to server administrators. Reviewer status remains separate from submitted evidence. Backfill recognizes only known issue codes in the exact application v1 envelope and links only an existing owned scan; unrecognized prose is left alone.

Validation: run `supabase/tests/structured_feedback.sql` as an administrator after migration. Its synthetic fixtures roll back and exercise allowed reporting, enum/length checks, ownership, anonymous restrictions, private review access, and scan/account deletion. Client tests cover opted-out context, owned links, device-only context, failed lookup and account changes. No reports are training consent, and this migration creates no dataset export.
