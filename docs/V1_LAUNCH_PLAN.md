# DeepSpec V1 launch plan

Current direction: September 26, 2026. Target: **October 26, 2026**, conditional on the gates below. The [user's full master plan](V1_V2_MASTER_PLAN.md) is authoritative. This document translates it into implementation order and evidence; it is not a claim that V1 has launched.

## Product scope

Photo of a car part → useful identification and explanation → inspect the evidence → report or correct problems. Preserve original AI results and distinguish visible appearance from tested function. Do not promise exact fitment, hidden-fault detection, calibrated confidence, or functioning 3D reconstruction from a photograph.

V1 includes reliable saving, useful camera highlighting with a photo fallback, reporting, explicit data-use choices and enough review/monitoring to learn from real use. Firecrawl, custom model training, broad catalog integrations and advanced 3D are V2 candidates. Shop jobs remain an optional local prototype, not a prerequisite for a useful scan.

## Current audit

| Area | Evidence / status | Remaining gate |
| --- | --- | --- |
| Capture and explanation | Camera/upload, quality coaching, candidate results, follow-up chat and reports exist. | Run labeled-image evaluation with a working provider; record wrong and failed cases, not just successes. |
| Saved inspections | Existing device drafts/recovery plus live cloud inspection round-trip passed September 26. | Final deployed-app smoke test and actual-phone interruptions. |
| Private storage | Live `scan-images` bucket private; ownership policies; second-account denial tested. | Verify final deployment points at this same project. |
| Feedback | Result report link, 18 issue reasons, optional details, explicit scan-context checkbox. Existing ratings/corrections preserved. Administrator SQL review queue added September 27. | Structured issue/owned-scan/prediction fields and conservative legacy backfill added September 27. Retry/outbox and attachments remain. |
| Feedback ownership | DB defaults new rows to `auth.uid()` and rejects supplied foreign ownership; logged-out reports remain allowed. | Public feedback abuse throttling and deletion/retention workflow before wider launch. |
| Camera overlays | Captured-frame highlighting and viewport placement exist. Active Scanner does not currently use the separate live tracking hook. | Physical iOS/Android tests; polish bounded component lock/highlight without claiming spatial tracking. |
| Training permission | Durable default-off per-scan cloud consent, withdrawal, server revisions and administrator-only review queues added September 27. Local shop preference is not authority. | Versioned administrator-only membership and checked exporter added September 27. Human review, export-copy purging and a full consent-event history remain operational limits. No automatic training. |
| Operational data | Cloud model/candidate/evidence/sync records exist; quality counters are device-local. | Stable run IDs, prompt/pipeline versions and idempotent new detail syncs added September 27. Central error visibility and beta aggregation remain; old duplicate rows are not distinct inference counts. |
| Cost protection | Server limiter SQL deployed; browser execution revoked; production limiter failure returns 503 before inference. | Production service credential, trusted proxy IP and rate-limit smoke test; provider spend cap; scheduled counter cleanup. |
| Auth | Live signup and no-email auth enabled; anonymous owner/isolation test passed. | Email/password, delivery, recovery and cross-device login require test credentials. CI public configuration was missing on baseline. |
| Pricing | Possible seller/shop/occasional-user offers are hypotheses. | Validate value; paid-credit concurrency and billing gates are separate from an unpaid beta. |

Code evidence: `src/screens/Scanner.tsx`, `src/components/scanner/FocusedPartOverlay.tsx`, `src/services/cloudSync.ts`, `src/services/scanQualityMetrics.ts`, `src/services/trainingReadiness.ts`, `src/services/shop.ts`, `api/rateLimit.shared.ts`, `api/requireSession.shared.ts`, `api/billing.shared.ts`. See [foundation report](V1_FOUNDATION_REPORT_2026-09-26.md) for changes and checks.

## One-month sequence

| Window | Work | Evidence required to move on |
| --- | --- | --- |
| Sep 26–Oct 2 | Persistence, reports, ownership, consent architecture, cost protection and deployment configuration. | Live save/read/update/isolation; reports retained on delivery failure; explicit consent default off; deployed auth/rate check. |
| Oct 3–9 | Real automotive evaluation, bad photos, camera/overlay polish, mobile usability. | Labeled cases with errors retained; iOS Safari and Android Chrome on physical phones; no blocked essential controls. |
| Oct 10–16 | 5–15 trusted users, with little coaching. | Per-attempt success/error, usefulness, correction, latency, save outcome and confusion notes. No invented accuracy or time savings. |
| Oct 17–26 | Fix recurring issues, onboarding/privacy/terms, monitoring and production rehearsal. | No unresolved ownership or lost-save failures; operator sees a synthetic error; budget limits proven; rollback path documented. |

If a gate fails, reduce exposure or keep the beta private rather than asserting a public launch is ready. Recruiting and observing actual users cannot be replaced with automated tests.

## Next engineering slices

1. **Durable consent and review foundation implemented September 27:** default-off permission, policy version, server revision/time, withdrawal, privileged review, stale-write rejection and deletion cascade. See [the operator workflow and limitations](CONSENT_AND_REVIEW.md). Versioned membership and export checks are now implemented separately; do not treat queue readiness as an exported dataset.
2. **Structured reports:** administrator review states now exist in `feedback_reviews`, visible through `feedback_review_queue`: new → reviewed → confirmed issue → fixed. Queryable issue/context columns now preserve bounded, allowlisted context and separate reported prediction from scan correction. See [structured reports](STRUCTURED_FEEDBACK.md). Do not silently attach photos, chat, precise location, tokens or full request payloads. Existing recognized v1 text-envelope reports are conservatively backfilled without deleting their messages.
3. **Traceable examples implemented September 27:** original/cropped private objects, prompt/pipeline/run identity, reviewed versioned membership and export-time consent/hash checks. See [dataset operator workflow](DATASET_LINEAGE.md). Revoked/deleted examples are excluded, and changed metadata requires new review. Prior trained models may not support reversing an individual example, so do not promise automatic unlearning.
4. **Operational visibility, first slice implemented September 29:** opt-in private identification-service logs record release, event UUID, time, allowlisted code/status and latency; a bounded operator summarizer validates and deduplicates exports. A local synthetic configuration failure reached the summary without a provider call. See [diagnostics scope and operator steps](OPERATIONAL_DIAGNOSTICS.md). No photo, user ID or raw error text is included. Deployed log access/retention, other HTTP stages, client save failures and broader beta aggregation remain gates; this is not complete production monitoring.
5. **AR quality:** finish the captured-image flow first; add live tracking only with measured stability. Graceful retry, lighting/steadiness guidance and photo upload must remain reachable.

Training/evaluation use is separate from product storage and a thumbs-up. Successful and failed cases can be review candidates; neither is automatically approved ground truth. New review tables must use RLS, explicit grants and ownership checks. No new ML training or scraping is a V1 dependency.

## Beta measurement

Record attempt ID, task, device, completion, identification accepted/rejected, independent label where available, latency, save/reload outcome, report reason and usefulness. Keep abandoned and failed attempts in denominators. New run keys deduplicate retries; do not count historical rows or hidden provider attempts as distinct inference requests.

A parts seller can be one cohort. The [seller runbook](PILOT_RUNBOOK.md) proposes 10 manual baseline observations followed by 10 manual/10 assisted comparable distinct parts. Its 30% lower median active-time threshold is a proposed target, not evidence. Measure support time and wrong accepted identities alongside speed.

## Release decision

- Owner/developer: verifies configuration, migration state, production smoke tests and rollback.
- Trusted beta users: provide actual-phone and usefulness evidence; no automatic agent claim substitutes for this.
- Project owner with parent/guardian support: handles accounts, public privacy/terms and any commercial agreements.
- Keep public launch blocked by data loss, cross-account access, missing cost protection, or inability to observe failures. Keep training disabled until consent, review and deletion/lineage tests pass.

The target is a useful and trustworthy V1, with evidence determining V2.
