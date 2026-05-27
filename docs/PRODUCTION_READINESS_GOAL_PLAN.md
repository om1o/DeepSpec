# Deep Spec Production Readiness Goal Plan

Audit date: May 21, 2026

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

- `npm run check` passed: lint, 24 test files, 134 tests, and production build.
- Browser QA passed for local auth continue and `/scan?test=1` fixture scan.
- Live QA scan identified the engine fixture as `Alternator` with high confidence and no browser console errors.
- May 22 browser QA on mobile viewport `390x844` confirmed `/scan?test=1` now renders only the test scanner state, with `Test scan ready`, `Test engine photo`, and no camera-denied copy.
- May 22 browser QA confirmed `/scan` with denied camera shows `Camera access needed` plus the gallery fallback controls, and uploading `public/test-fixtures/engine-scan-test.jpg` reaches a saved result screen. The live identify call returned `500` because this local server is missing `GEMINI_API_KEY`.
- `npm run verify:supabase` failed at anonymous Supabase sign-in: `Database error creating anonymous user (unexpected_failure), HTTP 500`.
- `npm run eval:identify` passed 5 of 6 sampled dataset cases and failed 1 with `invalid_response`.
- May 27 `npm run check` passed: lint, 28 test files, 185 tests, and production build.
- May 27 `npm run eval:identify -- --sample-size 50 --delay-ms 0 --max-provider-failures 1` used the local 50-case set and stopped at 12/50 because provider availability failed after fallback; latency, invalid response rate, and safety false-positive metrics are written to `.deepspec-eval/identify-summary.json`.
- GitHub connector found no open standalone issues in `om1o/DeepSpec`, but multiple open PRs, with #13 the latest visible PR.
- Hugging Face context: `microsoft/trocr-large-printed` is the current OCR fallback model, and `DrBimmer/car-parts-and-damage-dataset` is the current local/eval dataset source.
- Google Lens reference behavior from official Google pages: camera/image/screenshot input, multiple result modes, ranked visual results, text copy/translate, visual matches, shopping/context actions, and ask/refine flows.

## Verified Production Gaps

| ID | Severity | Area | Finding | Evidence | Fix Direction |
| --- | --- | --- | --- | --- | --- |
| P0-001 | Blocker | Database | Cloud sync is not production ready because Supabase anonymous sign-in fails before storage or RLS can be proven. | `npm run verify:supabase` failed at step 1. | Fix Supabase Auth logs/triggers/config, rerun verifier until all 6 steps pass. |
| P0-002 | Blocker | Output reliability | Identify eval still cannot complete the release set because provider availability fails after fallback. | May 27 release eval stopped at 12/50 with `network` after both configured models failed. | Keep provider fallback, fix quota/network/provider stability, rerun the 50-case gate until all samples complete. |
| P0-003 | Blocker | Backlog hygiene | There are no open standalone GitHub issues for production readiness. | GitHub issue search returned empty. | Convert this plan into milestones and issues instead of hiding work in PRs. |
| P0-004 | Blocker | Release quality | Open PR stack is large and overlapping. | GitHub returned open PRs #4-#13. | Merge/close/rebase PRs into a clean production branch before broad changes. |
| P1-001 | High | Scanner UX | Resolved on current branch: `/scan?test=1` bypasses camera-blocking copy and renders a clean non-camera scanner state. | Browser QA on May 22 showed `Test scan ready` and `Test engine photo` without `Camera access needed`; `src/screens/Scanner.test.tsx` passed 13 tests. | Keep regression coverage and verify this route in every browser smoke pass. |
| P1-002 | High | Result UX | Partially resolved: result output now keeps a sticky primary match/action card and segments Match, Evidence, Sources, and Review. | `src/screens/Result.test.tsx` covers tabbed result sections. | Continue with image callouts and desktop split layout. |
| P1-003 | High | Result accuracy | The fixture alternator was treated as professional verification needed. | Live QA result showed high confidence alternator plus safety-critical/pro verification warning. | Recalibrate safety triage so ordinary electrical parts are not escalated unless visible risk exists. |
| P1-004 | High | Evidence UX | Evidence is displayed as text chips disconnected from image regions. | Live result has evidence chips below the fold only. | Add image callouts/regions and map evidence to visible observations. |
| P1-005 | High | Alternatives | App returns one answer only; Lens often ranks possible results and may show alternatives. | Current `IdentificationResult` has no alternatives. | Add `candidateMatches[]` with confidence/reason/source. |
| P1-006 | High | Follow-up | Ask/refine is hidden behind saved scan chat, not on the first result. | Live QA result has no immediate ask/refine input because QA scans are unsaved. | Add result-level "Ask about this" and "Refine with another angle" actions. |
| P1-007 | High | Persistence | QA scan intentionally does not save, so browser QA cannot verify saved controls from the fixture. | Result shows "not saved to history, cloud sync, or training review." | Add a local QA seed route or test-only save toggle for production QA. |
| P1-008 | High | Cloud UI | UI can say cloud sync is ready even when end-to-end verification fails. | Early Access showed cloud ready; verifier failed anonymous sign-in. | Add runtime cloud health state: configured, auth-ok, storage-ok, RLS-ok, last verified. |
| P1-009 | High | Copy/content | Early Access says cloud sync is ready but form copy says backend sync comes later/local-only. | Browser snapshot. | Make cloud copy state-driven and non-contradictory. |
| P1-010 | High | Database shape | `scan_lookups` stores result JSON but no separate model-run metadata table. | Migration inspection. | Add model run metadata after P0 cloud auth is fixed: provider, model, latency, prompt version, error code, OCR used. |
| P1-011 | High | Dataset quality | Local storage caps saved scans at 50. | `MAX_SAVED_LOOKUPS = 50`. | Keep local cap, but cloud dataset must preserve all synced scans with retention/export policy. |
| P1-012 | High | Corrections | Correction is plain text only, not structured enough for training. | `correction: string`. | Add corrected part/category/damage severity/region fields in cloud review layer. |
| P1-013 | High | Visual search | Partially resolved on current branch: upload-from-gallery is visible in the live scanner and remains available when camera permission is denied. | Browser QA on May 22 showed `Upload photo` and `Paste image` in the denied-camera state; uploading the engine fixture reached a saved result screen, but live AI identify returned `500` because the local server lacks `GEMINI_API_KEY`. | Keep the upload fallback, then rerun live upload with provider configuration before calling the visual-search path production ready. |
| P1-014 | High | OCR | OCR is label-rescue only and invisible to the user. | Code path appends OCR text as evidence. | Show extracted label text as a source/evidence item and allow correction. |
| P1-015 | High | Eval | Fixed release eval set exists, but the gate is not green yet. | May 27 run requested 50 cases and recorded latency, invalid response, and safety false-positive metrics before provider failure stopped the run. | Fix provider availability, then rerun `npm run eval:identify:release`. |
| P2-001 | Medium | Desktop layout | App is mobile-width centered on desktop with large empty side gutters. | Browser screenshot. | Keep mobile-first but add useful desktop panel layout: image left, result sheet right. |
| P2-002 | Medium | Screenshot/render | Full-page screenshot repeats fixed header and image sections awkwardly. | Browser full-page capture. | Review fixed positioning and print/export capture behavior. |
| P2-003 | Medium | History | Resolved locally: history has search, category/review/rating filters, saved count, cap warning, and JSON export. | `src/screens/History.test.tsx` covers filters and export control. | Recheck in browser smoke and add cloud export once Supabase passes. |
| P2-004 | Medium | Sources | References are generic Google/NHTSA links, not result-ranked sources. | Live result links. | Add source groups: similar dataset examples, OEM/manual search, recall search, nearby help. |
| P2-005 | Medium | User trust | No "why this might be wrong" section. | Result only shows evidence and concerns. | Add uncertainty reasons and retake guidance next to primary answer. |
| P2-006 | Medium | Saved scan grouping | Saved scan controls mix dataset metadata, chat, rating, cloud sync, report export, and deletion in one long card. | Code inspection. | Group as tabs or sections: Review, Actions, Cloud, Export, Danger zone. |
| P2-007 | Medium | Safety | Safety copy is repeated in `Trust check`, `Safety-critical`, and `Next action`. | Live result. | Deduplicate into one clear safety state with one action. |
| P2-008 | Medium | Data review | No in-app dataset review dashboard exists. | Routes are scan/history/result/chat/early-access/auth. | Add internal review queue after cloud sync passes. |
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
| Output quality | 100 | accuracy, invalid JSON, confidence, calibration, safety false positives, latency |
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

- Fix the `invalid_response` eval failure and add it as a regression test.
- Release eval set has at least 50 fixed cases before beta and 300 before public launch.
- Metrics include accuracy, invalid response rate, latency, safety false positives, safety false negatives, OCR usage, and cloud sync success.
- Confidence and safety triage are calibrated; an ordinary alternator should not be escalated unless visible risk exists.

### Milestone 4: Dataset-Ready Persistence

Exit criteria:

- Every real scan can sync to Supabase.
- Cloud data preserves photo, result, candidates, corrections, notes, chat, OCR, model run, and review status.
- Internal review queue exists for wrong/low-confidence/failed scans.
- Export path exists for evaluation/training without leaking private user data.

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
- `npm run eval:identify` meets the release threshold.
- `npm run verify:supabase` passes.
- Browser QA passes on `/auth`, `/scan`, `/scan?test=1`, `/result`, `/history`, `/early-access`, and chat.
- The output is Lens-like: image-first, ranked, visual, actionable, and easy to correct.
- Every scan can become durable dataset data.
- GitHub issues/milestones reflect the production backlog.
- Remaining risks are written down, not hidden.
