# Automatic intake draft — September 20, 2026

Saved result detail now prepares an intake draft without requiring the optional human inspection form. The same draft is included in Share/Export through the existing report builder. Existing scans get drafts when opened; no migration, additional model call or duplicate record is needed.

The draft shows the suggested name, source of identity, recorded part number, functional-test status and outstanding checks. Human inspection takes precedence over a user correction, which takes precedence over the AI suggestion. Corrections remain explicitly unverified. AI confidence, positive ratings and OCR do not populate confirmed identity, part number or functional-test fields. Fitment verification remains required even when a part number and a passing human test are recorded.

Drafts are derived from the current lookup each time, so updated analysis and saved inspections feed the next display/export. No training-consent fields are changed. Failed scans explicitly show missing identification; reports no longer describe missing concerns or missing analysis as a reassuring condition assessment.

## Verification

- 39 tests passed across `src/services/report.test.ts` and `src/screens/Result.test.tsx`, including automatic draft after Save, absent human inspection, report inclusion, missing analysis, retake evidence, deduplication and all human functional-test states.
- Repository lint and production build passed. Existing large-chunk build warning remains.
- QA doctor passed before the browser run.
- Production-build mobile emulation (390 × 844): auth-login, saved-history and result-detail passed. History/detail use seeded local fixtures. No new live engine call or physical-camera test was needed for this derived UI change.
- Visually inspected `artifacts/qa/2026-09-20T18-02-02-394Z/screenshots/result-detail.png`: draft and outstanding checks readable, export controls available.
- Full browser report: `artifacts/qa/2026-09-20T18-02-02-394Z/report.md`; screenshots, trace and video in the same directory. No frontend, backend, auth/session or environment failures in this scoped run.

## Remaining work

This is automatic draft preparation, not unattended intake or an inventory integration. Bounded guided retakes, explicit exception handling, customer timing studies and catalog verification remain planned. Text report generation is tested; this run did not exercise a native share sheet or downloaded file in a physical phone browser. The previously confirmed missing cloud `inspection_json` migration still blocks dependable cloud inspection records; this increment does not fix or hide it. No production deployment or accuracy improvement is claimed.
