# Deep Spec Production Readiness Goal Plan

Audit date: May 22, 2026

## Goal

Make Deep Spec production ready as a domain-specific Google Lens for car parts:

1. A user can open the app, scan or upload a car photo, and get a fast, trustworthy, image-first answer.
2. The answer feels like visual search, not a static report: primary match, alternatives, evidence tied to the image, actions, sources, and follow-up questions.
3. Every scan photo, model output, user correction, rating, notes, chat, and sync status is preserved as dataset-ready product data.
4. The app is safe to ship: auth works, cloud sync works, RLS is proven, model failures are recoverable, and production checks are repeatable.

## Pushback On The "900 Bugs" Ask

Do not invent 900 fake bugs. That would make the backlog noisy and weaker.

Use a 900-check audit grid instead: 9 production tracks x 100 checks each. Every item must be reproducible, tied to a route, command, screenshot, code path, or database proof. The seed findings below are verified from this checkout and should become the first GitHub issues or milestone tasks.

## Evidence From This Audit

- `npm run check` passed locally on May 22, 2026: lint, 30 test files, 221 tests, and production build.
- GitHub Quality gate has also passed `npm ci`, `npm run check`, and production build on the current release stack; the release cloud gate must still fail until Supabase Actions secrets are configured.
- The live GitHub release stack is down to one open draft production-readiness PR.
- Browser QA passed for `/scan?test=1` on the current release branch: the test engine photo opened `/result`, identified `Alternator`, switched through the Match/Evidence/Sources tabs, and produced 0 local app console errors.
- Browser QA on `/early-access` passed the failure-state check: cloud health reports the Supabase Auth/database blocker without hiding storage/RLS as verified.
- `npm run eval:identify:release` passed 50/50 fixed Hugging Face samples with provider available, 0 provider failures, and 0 failure review rows.
- `npm run verify:identify-eval` passed with `Identify eval passed: 50/50 samples passed with provider available.`
- `npm run eval:identify:public` now defines the 300-sample public-launch gate with a balanced Hugging Face tree sample, verifier minimum of 300 attempted samples, and summary metrics for accuracy, invalid responses, provider failures, retries, latency, OCR usage, and rule-derived safety false positives/false negatives. A live Hugging Face tree check returned 300 sample paths. This is not a substitute for a completed live provider run.
- Provider hang guards are now covered: browser AI requests abort after 60s, and release eval samples have a 240s per-sample budget including retries.
- Provider quota handling now preserves sanitized `Retry-After` timing for identify/chat `429` responses, surfaces it through the client error type, and lets the eval harness use it when shorter than the default retry backoff.
- Browser QA passed for `/scan?test=1&save=1`: the fixture saved one local-only `testRun` lookup, kept the training label as `Alternator`, disabled cloud sync, and produced 0 browser console/runtime errors.
- Result evidence regions now carry typed anchors (`scanned_area`, `upper_left`, `center`, `lower_right`, etc.) so API output, saved scans, and the image overlay can agree on where each clue belongs. Old free-text region labels are still inferred into anchors for backward compatibility.
- Result follow-up now has a typed `Ask about this result` form that saves unsaved real scans before opening chat, while saved scans open chat directly with the typed question.
- Alternate matches can now be promoted into the correction/training-label path from the result screen, including unsaved real scans that need to be saved before review.
- Auto scan now tracks whether a detected object is actually inside the visible scanner reticle, gives "Move part into box" feedback when it is outside, and only accrues the 5-second hold while the target stays inside the reticle.
- Local saved-scan retention now keeps up to 300 records and `/history` exports dataset JSON with photo, result, correction, notes, chat, OCR/model metadata, prompt versions, latency, and sync events.
- Local dataset export, review queue export, and cloud `metadata_json` now include structured review metadata derived from rating, correction, training label/status, original part, confidence, and training category.
- Result source cards now group links by purpose: visual dataset matches, research, nearby help, and safety. Hugging Face dataset evidence URLs are promoted into the ranked source card instead of only appearing as footnotes.
- Result output now includes a "Why it might be wrong" card with uncertainty reasons and retake guidance derived from confidence, alternate matches, source coverage, evidence regions, and better-photo flags.
- Result output now uses Match/Evidence/Sources/Ask tabs inside the image-first result sheet. QA test results hide Ask because they stay local-only; `Result.test.tsx` covers the real-scan Ask tab.
- Early Access cloud copy now stays state-driven: configured Supabase public keys do not call waitlist or feedback cloud sync ready until the verifier and privacy review pass. `EarlyAccess.test.tsx` covers both unconfigured and configured-local-only copy.
- OCR label rescue output now appears as detected image text with copy/search actions, and saved scans can promote that detected label into the correction/training-label flow.
- Saved scan controls are now split into Review, Actions, Cloud, Export, and Danger zone sections so rating/correction, follow-up, sync, report export, and deletion are not mixed together in one long control stack.
- History now has review filters for search, category, review status, and confidence so saved scans can be narrowed before opening results or exporting the local dataset.
- A configured `npm run verify:supabase` run still failed after confirming anonymous sign-ins were enabled: anonymous signup returned `Database error creating anonymous user (unexpected_failure), HTTP 500`.
- Latest captured configured-run Supabase request/error id: `019e50fe-bf47-784c-8177-c54c0f323cb8`.
- Remote Supabase repair is blocked from this workspace until an authenticated Supabase CLI session, `SUPABASE_ACCESS_TOKEN`, or privileged Postgres connection is available; the current env files only provide public app config plus the Gemini key.
- The release checkout can reach the hosted verifier after copying the local public Supabase `.env.local` from `C:\Users\omiol\deepspec`, but it still fails at anonymous user creation before storage/RLS checks.
- Supabase Preview check on the active release PR passed.
- GitHub Actions release gate is failing because repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are not configured.
- Hugging Face connector confirmed `DrBimmer/car-parts-and-damage-dataset` as the current fixed release dataset source: 1,812 high-resolution polygon-annotated car part/damage images, MIT license, object-detection and image-segmentation tags.
- Google Lens reference behavior from official Google pages: camera/image/screenshot input, multiple result modes, ranked visual results, text copy/translate, visual matches, shopping/context actions, and ask/refine flows.

## Verified Production Gaps

| ID | Severity | Area | Finding | Evidence | Fix Direction |
| --- | --- | --- | --- | --- | --- |
| P0-001 | Blocker | Database | Cloud sync is not production ready because Supabase anonymous sign-in fails before storage or RLS can be proven. | `npm run verify:supabase` failed at step 1. GitHub issue: #57. | Fix Supabase Auth logs/triggers/config, rerun verifier until all 6 steps pass. |
| P0-002 | Blocker | Database access | The anonymous Auth repair cannot be applied from this workspace because no Supabase CLI token or privileged Postgres connection is available. | `npx supabase projects list` fails with missing access token, and env-file inspection found no `SUPABASE_DB_URL`, `DATABASE_URL`, or `PG*` connection variables. | Add `SUPABASE_ACCESS_TOKEN` or a privileged DB connection, run the printed diagnostics in Supabase SQL Editor, apply the narrow Auth repair only if diagnostics confirm the standard profile trigger, then rerun `npm run verify:supabase`. |
| P0-003 | Blocker | Backlog hygiene | There are no open standalone GitHub issues for production readiness. | GitHub issue search returned empty. | Convert this plan into milestones and issues instead of hiding work in PRs. |
| P0-004 | Blocker | Release quality | The active release PR is still draft. | The active release PR is the only open release PR and remains draft. | Keep review honest, keep superseded PRs closed, and make the active release PR ready only after cloud gates pass. |
| P0-005 | Blocker | CI secrets | Release CI cannot prove cloud sync because public Supabase Actions secrets are missing. | Quality gate prints empty `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then exits 1 for the production-readiness PR title. GitHub issue: #58. | Add those two repository secrets, rerun CI, and require `npm run verify:supabase` to pass in Actions. |
| P1-001 | High | Scanner UX | Test mode now bypasses camera-blocking copy, but it still needs live browser coverage alongside real camera denial states. | `Scanner.test.tsx` covers blocked camera plus clean `/scan?test=1`. | Run browser QA for `/scan?test=1`, blocked camera, and upload on mobile viewport before launch. |
| P1-002 | High | Result UX | Result output is closer to a visual result sheet, but it is still not fully Google Lens-like. | Result now has candidates, image evidence, ranked sources, ask/refine actions, uncertainty, one `Safety state` card, and Match/Evidence/Sources/Ask tabs inside the image-first two-pane result sheet. Browser QA passed the QA result's Match/Evidence/Sources tabs. GitHub issue: #87. | Add mobile viewport QA and keep tightening toward a true Lens bottom sheet/carousel flow after provider and cloud gates are stable. |
| P1-003 | High | Result accuracy | The fixture alternator no longer escalates in the QA fixture, and eval summaries now count rule-derived safety false positives/false negatives. Broader calibration still needs a completed public eval. | `TEST_ENGINE_IDENTIFICATION` uses `safetyTriage: "can_help"` and `isSafetyCritical: false`; browser QA showed `Useful match`; `buildEvalSummary()` reports `safetyEscalationCount`, `safetyFalsePositiveCount`, `safetyFalsePositiveRate`, `safetyFalseNegativeCount`, and `safetyFalseNegativeRate`. | Run the 300-sample public eval with provider quota available and use the safety false-positive/false-negative metrics to tune escalation. |
| P1-004 | High | Evidence UX | Evidence can now anchor to coarse image regions, but not exact boxes or masks. | `EvidenceRegion.anchor` is preserved and rendered in image callouts; there are no pixel coordinates. | Keep coarse anchors for model safety, then add optional detector/manual region boxes only when image-coordinate evidence is trustworthy. |
| P1-005 | High | Alternatives | Candidate matches can now be selected as the corrected training label, and each alternate can carry safe research links. Ranking is still lightweight. | `candidateMatches[]` carries ranked part/confidence/reason/sourceLinks, and `Mark correct` promotes an alternate into rating/correction/training status. Candidate links are search/dataset references, not fitment guarantees. | Add richer candidate-specific evidence and source ranking. |
| P1-006 | High | Follow-up | QA test scans intentionally cannot chat, but real unsaved and saved result follow-up now works from the result screen. | `ResultAskBox` saves unsaved real scans before chat and opens saved scans directly with typed `?q=` context. | Keep QA test scans unsaved; continue improving chat reliability after provider quota and Supabase gates are fixed. |
| P1-007 | High | Persistence | QA scan stays memory-only by default, and testers can now opt into a local-only saved QA seed for review-control QA. | `/scan?test=1` remains no-save; `/scan?test=1&save=1` creates a local `testRun` lookup and disables cloud sync/provider actions for that fixture. | Keep the QA seed local-only and use it for browser review-control checks; do not treat it as real training data. |
| P1-008 | High | Cloud UI | Runtime health state now exists, but it still cannot show ready until the Supabase verifier reaches storage and RLS. | `CloudHealthCard` tracks configured, anonymous auth, image upload, row upsert, RLS isolation, and last verified; the configured status copy says the verifier must pass first. | After Supabase Auth is fixed, run the runtime health check and require `lastVerifiedAt` plus passing storage/RLS before any production-ready cloud copy. |
| P1-009 | High | Copy/content | Early Access no longer calls cloud waitlist or feedback sync ready when Supabase config is only present. | `EarlyAccess.test.tsx` covers configured copy and submit messages that keep sync local-only until the Supabase verifier and privacy review pass; browser QA covered `/early-access` local-only saves with no console errors. | Keep this state-driven copy while Supabase Auth is repaired; enable real cloud engagement sync only after the verifier and privacy review pass. |
| P1-010 | High | Database shape | `scan_lookups` stores result JSON but no separate model-run metadata table. | Migration inspection. | Add model run metadata after P0 cloud auth is fixed: provider, model, latency, prompt version, error code, OCR used. |
| P1-011 | High | Dataset quality | Cloud dataset persistence is still blocked even though local retention/export improved. | `MAX_SAVED_LOOKUPS = 300`, `getDatasetExport()`, and `/history` export button now preserve local dataset records; `npm run verify:supabase` still fails. | Keep the local export as a fallback, but cloud dataset must preserve all synced scans with retention/export policy. |
| P1-012 | High | Corrections | Local exports and cloud metadata now carry structured review metadata, but the UI correction input is still plain text and cloud review tables are deferred. | `getLookupDatasetMetadata()` and `getDatasetExport()` include review status, rating, correction text, original part/confidence, training label, and training category. | After Supabase Auth passes, add cloud review tables/fields for corrected part/category/damage severity/region instead of relying only on metadata JSON. |
| P1-013 | High | Visual search | Upload and pasted-image input exist, but Lens-style mobile share-sheet input is not covered yet. | Scanner accepts JPEG/PNG/WebP upload and pasted image blobs; tests cover upload and pasted screenshots while camera is blocked. | Add mobile share intent handling after the core camera and cloud gates are stable. |
| P1-014 | High | OCR | OCR label text is now visible and can feed corrections, but OCR still runs only as a gated label-rescue path. | `Result.test.tsx` covers detected label output, copy/search actions, and `Use as correction` updating rating, correction, training label, and review status. GitHub issue: #89. | Keep OCR gated until eval data proves broader OCR improves accuracy; add browser QA for a real blurry-label fixture when that fixture exists. |
| P1-015 | High | Eval | Beta release eval is fixed at 50 cases, and a separate public-launch command now enforces a 300-sample gate with launch metrics. A completed live 300-sample provider run is still required before public launch. | `npm run eval:identify:release` passed 50 fixed samples; `npm run eval:identify:public` runs `--sample-set public --sample-size 300` and verifies `--min-sample-size 300`; `eval-identify.test.mjs` covers balanced 150 damage / 150 parts selection, retry counts, latency distribution, invalid-response rate, provider-failure rate, OCR usage, and safety false-positive/false-negative metrics. GitHub issue: #90. | Run the 300-sample public eval with provider quota available and inspect the generated quality metrics before launch. |
| P1-016 | High | Scanner auto-capture | Auto scan now requires reticle overlap and a stable 5-second hold, but it still needs real camera/video-frame QA before public launch. | `useObjectTarget` resets hold outside the scanner box; `src/hooks/useObjectTarget.test.tsx` covers outside, inside, and leave/reenter behavior. | Run a real mobile camera/video-frame pass with engine-bay and exterior part images and tune overlap thresholds if needed. |
| P2-001 | Medium | Desktop layout | App is mobile-width centered on desktop with large empty side gutters. | Browser screenshot. | Keep mobile-first but add useful desktop panel layout: image left, result sheet right. |
| P2-002 | Medium | Screenshot/render | Full-page screenshot repeats fixed header and image sections awkwardly. | Browser full-page capture. | Review fixed positioning and print/export capture behavior. |
| P2-003 | Medium | History | History now supports search plus category, review-status, and confidence filters; import remains deferred until the cloud baseline is stable. | `History.test.tsx` covers filter behavior and `/history` exports dataset JSON from local saved scans. | Add an import path after cloud sync and review retention rules are stable. |
| P2-004 | Medium | Sources | Source links are now grouped by purpose and dataset evidence is surfaced in the ranked source card, but OEM/manual and recall-specific source ranking is still lightweight. | Browser smoke on `/result/source-group-browser` showed Visual dataset matches, Research, Nearby help, and Safety groups with 0 console errors. | Add stronger OEM/manual, recall, and model-specific reference ranking after provider/cloud gates are stable. |
| P2-005 | Medium | User trust | A "Why it might be wrong" card now explains uncertainty and retake guidance, but it still uses rule-derived reasons rather than calibrated model probabilities. | `Result.test.tsx` covers alternate-match and low-confidence uncertainty; browser smoke should continue checking the card on saved results. | Add calibrated uncertainty once larger eval metrics and provider confidence data exist. |
| P2-006 | Medium | Saved scan grouping | Saved scan controls are now grouped into Review, Actions, Cloud, Export, and Danger zone sections. | `Result.test.tsx` covers the section headings and existing saved-scan actions. | Keep the controls sectioned until browser QA proves a compact saved-scan tab adds clarity without hiding dataset review controls. |
| P2-007 | Medium | Safety | Result safety guidance is now consolidated into one `Safety state` card with one action. | `Result.test.tsx` covers ordinary, better-photo, and professional-verification states without the old repeated `Next action` section. | Tune copy after real mobile/browser QA if users still miss the safety state. |
| P2-008 | Medium | Data review | No in-app dataset review dashboard exists, but local exports can now isolate scans that need human triage. | `/history` exports a review queue JSON for failed, wrong, corrected, unreviewed, low-confidence, safety, and better-photo scans while excluding QA test seeds. GitHub issue: #88. | Add a real internal review dashboard after cloud sync passes. |
| P2-009 | Medium | Observability | No production logging/analytics plan for scan failures, invalid responses, latency, or sync errors. | Code/log inspection. | Add privacy-safe event logging and release dashboard. |
| P2-010 | Medium | Auth | Local dev bypass exists while Supabase config is present. | Auth screen shows local continue. | Keep for dev only; production build must prove bypass absent. |

## Google Lens-Like Result Target

Current Deep Spec output should be replaced by a result surface with this hierarchy:

1. Image hero with visible focus region and optional evidence callouts.
2. Bottom result sheet with the primary answer: part name, confidence, category, and safety state.
3. Candidate carousel: alternate possible parts with short reasons.
4. Action row: ask, retake, add another angle, save, sync, share, find nearby help.
5. Tabs or segmented sections:
   - Match: what it is and what it does.
   - Evidence: visual clues mapped to the photo.
   - Concerns: visible damage/risk only.
   - Sources: dataset matches, web/reference links, OCR labels.
   - Review: helpful/wrong, correction, notes, training status.
6. Follow-up prompt directly on the result, even before the scan is saved.
7. Clear failure sheet for rate limits, invalid responses, offline state, bad photos, and cloud sync errors.

## Database Goal

Do not expand the schema until Supabase anonymous sign-in passes. The current production blocker is Auth, not table design.

After Auth is fixed, evolve the database in narrow steps:

1. Keep `scan_lookups` as the user-facing saved scan table.
2. Add `scan_model_runs` for provider/model/prompt version/latency/OCR/eval/error metadata.
3. Add `scan_candidates` for alternate matches and ranked confidence.
4. Add `scan_evidence` for structured evidence tied to optional image regions.
5. Add `scan_corrections` for structured user corrections and review status.
6. Add `sync_events` for upload/upsert/delete audit trail.
7. Add an internal `dataset_review_queue` view/table only after real scans sync reliably.

Minimum preserved fields for every scan:

- Original image path and hash
- Captured timestamp and analyzed timestamp
- Primary result JSON
- Candidate results
- Category and training label
- Confidence and safety triage
- OCR text if used
- Evidence and visible observations
- User rating, correction, notes, chat
- Model/provider/prompt version
- Sync status and failure reason

## 900-Check Production Audit Grid

| Track | Checks | Focus |
| --- | ---: | --- |
| Scanner capture | 100 | camera permissions, test mode, upload mode, blur/dark/bright, multi-frame, cancel, retry |
| Result UX | 100 | Lens-like grouping, image callouts, candidates, actions, safety, mobile/desktop |
| Output quality | 100 | accuracy, invalid JSON, confidence, calibration, safety false positives/false negatives, latency |
| Database | 100 | auth, RLS, storage, migrations, sync, retention, export, deletion |
| Dataset/eval | 100 | Hugging Face dataset integrity, eval coverage, failure review, label taxonomy |
| Auth/privacy | 100 | OTP, Google OAuth, local bypass boundaries, PII copy, privacy docs |
| History/review | 100 | filters, corrections, notes, review queue, training labels |
| Chat/follow-up | 100 | context grounding, safety limits, persistence, rate limits |
| Release/observability | 100 | CI, browser smoke, logs, metrics, Sentry/alerts, GitHub issue hygiene |

## Milestone Plan

### Milestone 0: Clean Release Baseline

Exit criteria:

- Close or merge stale overlapping PRs.
- Convert this plan into GitHub milestones/issues.
- Keep `npm run check` green.
- Keep current user changes separate from production plan commits.

### Milestone 1: Fix Database Blocker

Exit criteria:

- `npm run verify:supabase` passes all 6 steps.
- Supabase Auth logs show anonymous user creation works.
- Private image upload, row upsert, owner read, cross-user deny, and owner download are proven.
- UI cloud status is based on real verification state, not just config presence.

### Milestone 2: Make The Result Like Google Lens

Exit criteria:

- Result screen is image-first with a bottom sheet.
- Primary match, alternatives, evidence, concerns, actions, and review are grouped cleanly.
- Evidence can be tied to image regions when available.
- Follow-up/refine is available from the result without forcing the user through saved history first.
- Desktop has a useful two-pane layout.

### Milestone 3: Output Reliability

Exit criteria:

- Keep the fixed `invalid_response` / provider-availability regressions covered by tests.
- Release eval set has at least 50 fixed cases before beta and 300 before public launch.
- Metrics include accuracy, invalid response rate, latency, safety false positives, safety false negatives, OCR usage, and cloud sync success.
- Confidence and safety triage are calibrated; an ordinary alternator should not be escalated unless visible risk exists.

### Milestone 4: Dataset-Ready Persistence

Exit criteria:

- Every real scan can sync to Supabase.
- Cloud data preserves photo, result, candidates, corrections, notes, chat, OCR, model run, and review status.
- Internal review queue exists for wrong/low-confidence/failed scans.
- Local export path exists for evaluation/training while Supabase is blocked; public launch still needs the cloud verifier and privacy-reviewed export policy.

### Milestone 5: Full App Production QA

Exit criteria:

- Real browser smoke passes on mobile and desktop.
- Camera, upload, result, history, saved result, correction, chat, waitlist, feedback, cloud sync, and offline/retry states are tested.
- No 404s or console errors in core routes.
- Production build has no local auth bypass.
- Privacy/legal copy is ready for real users before collecting photos or emails at scale.

## Definition Of Done For Production

Deep Spec is not production ready until all of these are true:

- `npm run check` passes.
- `npm run eval:identify:release` meets the release threshold.
- `npm run verify:supabase` passes.
- Browser QA passes on `/auth`, `/scan`, `/scan?test=1`, `/result`, `/history`, `/early-access`, and chat.
- The output is Lens-like: image-first, ranked, visual, actionable, and easy to correct.
- Every scan can become durable dataset data.
- GitHub issues/milestones reflect the production backlog.
- Remaining risks are written down, not hidden.
