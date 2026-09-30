# V1 consent, reports and dataset foundation

September 27, 2026. Scope: launch-plan slices 1–3. This is implemented beta infrastructure, not a public launch or an automatic training pipeline.

## Changes

- Default-off per-scan cloud consent, explicit save/withdrawal, server revisions and stale-tab conflict handling. Administrator-only human review and report states.
- Structured 18-code reports, optional owned cloud-scan link and bounded reported prediction. Conservative legacy backfill preserves report messages. Local-only reports explain that their context is unlinked.
- Distinct inference/request IDs, prompt/pipeline versions, idempotent sync and preserved failures. Private saved derivatives have separate paths and integrity metadata.
- Immutable versioned dataset membership with reviewed label, consent and source/model fingerprints. Export eligibility binds the chosen run to the current prediction and rejects revoked, deleted, stale, failed or legacy examples.
- Administrator exporter with private bounded downloads, SHA-256 verification, final eligibility recheck and atomic output. No real example was approved or exported during this work.
- Fixed a React sibling-key collision between inspection and consent panels that could duplicate the inspection form during recovery updates.

## Evidence

| Check | Outcome / location |
| --- | --- |
| Consent SQL ownership/default/stale-write/revocation/deletion | Passed rollback-only synthetic regression: `supabase/tests/scan_training_consent.sql`. |
| Structured report SQL and deletion/ownership checks | Passed live rollback regression: `supabase/tests/structured_feedback.sql`. |
| Dataset run binding, current consent, privacy approval, immutability and source deletion | Passed live rollback regression: `supabase/tests/dataset_lineage.sql`. |
| Consent browser flow | Passed mobile/desktop save, reload, withdrawal, stale tabs and forced network failure; `artifacts/qa/consent-2026-09-27/report.json` and screenshots. |
| Inspection recovery browser flow | QA doctor passed; no-email auth and inspection-save-recovery passed. `artifacts/qa/2026-09-27T13-26-56-567Z/report.md`, screenshots, trace and video. Cloud failures in this scenario were deliberately intercepted. |
| Actual cloud inspection/image access | `npm run verify:supabase -- --inspection` passed owner reads/writes, second-account denials, private image checks and generated-fixture cleanup; `artifacts/qa/consent-2026-09-27/cloud-inspection.txt`. |
| Exporter | 30 synthetic integrity/permission/path/size tests passed; CLI help and ESLint passed. |
| Full code verification | `npm run check` passed: ESLint, 80 test files / 1,088 tests, TypeScript and production build. Log: `artifacts/qa/consent-2026-09-27/check-final.txt`. The final bounded prediction-retention addition separately passed 41 cloud-sync tests and ESLint. Existing large ML bundle warning remains. |
| Live provenance | Actual app-service/Supabase integration passed 15 checks: run count 1→2→3 across resync/new inference/failure, original/retry prediction retention, private original/crop SHA-256 and size, public URL denial, generated scan/object/model-run cleanup. Evidence: `artifacts/qa/provenance-2026-09-27/report.json`. No provider inference was requested. |

Browser emulation does not substitute for real iOS/Android camera tests. No-email QA accounts remain because public credentials cannot delete auth accounts; generated scan/image fixtures are removed and verified.

## Database migrations

The connected project is `tvmomaxmiecguqikpckb`. MCP records execution timestamps rather than local CLI creation timestamps:

| Local migration | Live version |
| --- | --- |
| `20260927091952_scan_training_consent_review.sql` | `20260927092421` |
| `20260927131844_structured_feedback.sql` | `20260927132719` |
| `20260927131914_scan_provenance.sql` | `20260927132532` |
| `20260927132408_dataset_lineage.sql` | `20260927132536` |
| `20260927132940_bind_dataset_prediction_run.sql` | `20260927133008` |

Do not blindly push local migrations to this already-migrated project: reconcile this mapping first. No unrelated billing/shop migration was deployed.

## Remaining gates and limits

- CI previously passed lint/tests/build but stopped at the auth gate because repository public Supabase configuration was missing. Real email/password delivery/recovery needs test credentials. A local passing build does not resolve either gate.
- Security advisors report five RLS-enabled tables with no browser policies deliberately restricted to service administrators, plus intended owner-scoped no-email access. See [RLS advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Existing [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains disabled.
- Dataset export is a point-in-time check; previously copied exports require purge/re-export after later withdrawal. No automatic unlearning or complete immutable consent-event history is provided.
- Stored crop/segmentation is a display derivative, not guaranteed to be the exact secondary inference input. Old duplicate model rows remain historical; unseen provider fallbacks are not counted.
- General report retention/deletion, abuse protection, operational incident visibility, deployed cost controls, physical phones and 5–15 real beta users remain launch gates. No accuracy or time-saving claim has been established.

Operator instructions: [consent/review](CONSENT_AND_REVIEW.md), [structured feedback](STRUCTURED_FEEDBACK.md), [dataset lineage/export](DATASET_LINEAGE.md), [launch plan](V1_LAUNCH_PLAN.md).
