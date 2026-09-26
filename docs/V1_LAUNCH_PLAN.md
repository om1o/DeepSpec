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
| Feedback | Result report link, 18 issue reasons, optional details, explicit scan-context checkbox. Existing ratings/corrections preserved. | Remote issue fields are currently a text envelope; searchable review states, retry/outbox and attachments remain. |
| Feedback ownership | DB defaults new rows to `auth.uid()` and rejects supplied foreign ownership; logged-out reports remain allowed. | Public feedback abuse throttling and deletion/retention workflow before wider launch. |
| Camera overlays | Captured-frame highlighting and viewport placement exist. Active Scanner does not currently use the separate live tracking hook. | Physical iOS/Android tests; polish bounded component lock/highlight without claiming spatial tracking. |
| Training permission | Local shop preference and quality triage exist; misleading learned-count copy removed. | Durable per-scan consent/revocation, human review and dataset lineage are unfinished. No automatic training. |
| Operational data | Cloud model/candidate/evidence/sync records exist; quality counters are device-local. | Stable model-run ID and prompt version; central error visibility and beta aggregation. Detail syncs can duplicate model-run rows. |
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

1. **Durable consent and review:** add a small owner-scoped report/consent model rather than duplicating scan storage. Explicit `training_consent=false`, consent policy version/time and revocation. Only privileged reviewers can set human verification or approval. Ordinary users must not self-approve examples. Include deletion behavior and tests before any dataset export.
2. **Structured reports:** additive issue/context/review-state columns; bounded, allowlisted context; preserve original prediction and correction separately. Review queue: new → reviewed → confirmed issue → fixed. Do not silently attach photos, chat, precise location, tokens or full request payloads. Existing text-envelope reports need a migration/backfill strategy, not deletion.
3. **Traceable examples:** reference original/cropped private objects separately when available; version prompt/pipeline and distinct inference run. A dataset membership table must record source scan, label provenance, consent snapshot and version. Recheck current consent during export; exclude revoked/deleted examples. Prior trained models may not support reversing an individual example, so do not promise automatic unlearning.
4. **Operational visibility:** record release, coarse device/browser, error code, latency and scan identifier only where appropriate. Demonstrate a synthetic incident reaching an operator. Start with reviewed exports for the small beta if that avoids a needless analytics platform.
5. **AR quality:** finish the captured-image flow first; add live tracking only with measured stability. Graceful retry, lighting/steadiness guidance and photo upload must remain reachable.

Training/evaluation use is separate from product storage and a thumbs-up. Successful and failed cases can be review candidates; neither is automatically approved ground truth. New review tables must use RLS, explicit grants and ownership checks. No new ML training or scraping is a V1 dependency.

## Beta measurement

Record attempt ID, task, device, completion, identification accepted/rejected, independent label where available, latency, save/reload outcome, report reason and usefulness. Keep abandoned and failed attempts in denominators. Do not count every `scan_model_runs` row as a distinct inference until retry identity is fixed.

A parts seller can be one cohort. The [seller runbook](PILOT_RUNBOOK.md) proposes 10 manual baseline observations followed by 10 manual/10 assisted comparable distinct parts. Its 30% lower median active-time threshold is a proposed target, not evidence. Measure support time and wrong accepted identities alongside speed.

## Release decision

- Owner/developer: verifies configuration, migration state, production smoke tests and rollback.
- Trusted beta users: provide actual-phone and usefulness evidence; no automatic agent claim substitutes for this.
- Project owner with parent/guardian support: handles accounts, public privacy/terms and any commercial agreements.
- Keep public launch blocked by data loss, cross-account access, missing cost protection, or inability to observe failures. Keep training disabled until consent, review and deletion/lineage tests pass.

The target is a useful and trustworthy V1, with evidence determining V2.
