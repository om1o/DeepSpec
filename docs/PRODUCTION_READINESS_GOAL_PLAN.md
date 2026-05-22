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

- `npm run check` passed locally on May 22, 2026: lint, 29 test files, 206 tests, and production build.
- GitHub Quality gate also passed `npm ci`, `npm run check`, 28 test files / 191 tests, and production build before intentionally failing the release cloud gate because Actions secrets are missing.
- Browser QA passed for `/scan?test=1` on the current release branch: the test engine photo opened `/result`, identified `Alternator`, rendered evidence/sources/actions, and produced 0 local app console errors.
- Browser QA on `/early-access` passed the failure-state check: cloud health reports the Supabase Auth/database blocker without hiding storage/RLS as verified.
- `npm run eval:identify:release` passed 50/50 fixed Hugging Face samples with provider available, 0 provider failures, and 0 failure review rows.
- `npm run verify:identify-eval` passed with `Identify eval passed: 50/50 samples passed with provider available.`
- Provider hang guards are now covered: browser AI requests abort after 60s, and release eval samples have a 240s per-sample budget including retries.
- Result evidence regions now carry typed anchors (`scanned_area`, `upper_left`, `center`, `lower_right`, etc.) so API output, saved scans, and the image overlay can agree on where each clue belongs. Old free-text region labels are still inferred into anchors for backward compatibility.
- Result follow-up now has a typed `Ask about this result` form that saves unsaved real scans before opening chat, while saved scans open chat directly with the typed question.
- Alternate matches can now be promoted into the correction/training-label path from the result screen, including unsaved real scans that need to be saved before review.
- Auto scan now tracks whether a detected object is actually inside the visible scanner reticle, gives "Move part into box" feedback when it is outside, and only accrues the 5-second hold while the target stays inside the reticle.
- Local saved-scan retention now keeps up to 300 records and `/history` exports dataset JSON with photo, result, correction, notes, chat, OCR/model metadata, prompt versions, latency, and sync events.
- A configured `npm run verify:supabase` run still failed after confirming anonymous sign-ins were enabled: anonymous signup returned `Database error creating anonymous user (unexpected_failure), HTTP 500`.
- Latest captured configured-run Supabase request/error id: `019e500e-52bb-769e-91e8-6df0646c3320`.
- A bare checkout-local `npm run verify:supabase` also needs `.env.local` copied in; without `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, it stops before the Auth preflight.
- Supabase Preview check on PR #50 failed with `Failed to fetch existing branch project`.
- GitHub Actions release gate is failing because repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are not configured.
- Hugging Face connector confirmed `DrBimmer/car-parts-and-damage-dataset` as the current fixed release dataset source: 1,812 high-resolution polygon-annotated car part/damage images, MIT license, object-detection and image-segmentation tags.
- Google Lens reference behavior from official Google pages: camera/image/screenshot input, multiple result modes, ranked visual results, text copy/translate, visual matches, shopping/context actions, and ask/refine flows.

## Verified Production Gaps

| ID | Severity | Area | Finding | Evidence | Fix Direction |
| --- | --- | --- | --- | --- | --- |
| P0-001 | Blocker | Database | Cloud sync is not production ready because Supabase anonymous sign-in fails before storage or RLS can be proven. | `npm run verify:supabase` failed at step 1. | Fix Supabase Auth logs/triggers/config, rerun verifier until all 6 steps pass. |
| P0-002 | Blocker | Release integration | Supabase Preview is failing before migration proof. | PR #50 check run `Supabase Preview` failed with `Failed to fetch existing branch project`. | Repair Supabase GitHub Integration/branch state in the Supabase dashboard, then push or rerun the preview check. |
| P0-003 | Blocker | Backlog hygiene | There are no open standalone GitHub issues for production readiness. | GitHub issue search returned empty. | Convert this plan into milestones and issues instead of hiding work in PRs. |
| P0-004 | Blocker | Release quality | The active release PR is still large and draft. | PR #50 changes 91 files and CodeRabbit skipped review because it is draft. | Keep review honest, close superseded PRs, and make PR #50 ready only after cloud gates pass. |
| P0-005 | Blocker | CI secrets | Release CI cannot prove cloud sync because public Supabase Actions secrets are missing. | Quality gate prints empty `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then exits 1 for the production-readiness PR title. | Add those two repository secrets, rerun CI, and require `npm run verify:supabase` to pass in Actions. |
| P1-001 | High | Scanner UX | Test mode now bypasses camera-blocking copy, but it still needs live browser coverage alongside real camera denial states. | `Scanner.test.tsx` covers blocked camera plus clean `/scan?test=1`. | Run browser QA for `/scan?test=1`, blocked camera, and upload on mobile viewport before launch. |
| P1-002 | High | Result UX | Result output is grouped like a report, not Google Lens. | Live result stacks `AI identification`, `Trust check`, `Safety-critical`, `What it does`, `What I see`, `Concerns`, `Evidence`, `Next action`, `Reference links`. | Replace with image-first Lens result sheet: primary match, alternatives, evidence chips, action tabs, sources. |
| P1-003 | High | Result accuracy | The fixture alternator was treated as professional verification needed. | Live QA result showed high confidence alternator plus safety-critical/pro verification warning. | Recalibrate safety triage so ordinary electrical parts are not escalated unless visible risk exists. |
| P1-004 | High | Evidence UX | Evidence can now anchor to coarse image regions, but not exact boxes or masks. | `EvidenceRegion.anchor` is preserved and rendered in image callouts; there are no pixel coordinates. | Keep coarse anchors for model safety, then add optional detector/manual region boxes only when image-coordinate evidence is trustworthy. |
| P1-005 | High | Alternatives | Candidate matches can now be selected as the corrected training label, and each alternate can carry safe research links. Ranking is still lightweight. | `candidateMatches[]` carries ranked part/confidence/reason/sourceLinks, and `Mark correct` promotes an alternate into rating/correction/training status. Candidate links are search/dataset references, not fitment guarantees. | Add richer candidate-specific evidence and source ranking. |
| P1-006 | High | Follow-up | QA test scans intentionally cannot chat, but real unsaved and saved result follow-up now works from the result screen. | `ResultAskBox` saves unsaved real scans before chat and opens saved scans directly with typed `?q=` context. | Keep QA test scans unsaved; continue improving chat reliability after provider quota and Supabase gates are fixed. |
| P1-007 | High | Persistence | QA scan intentionally does not save, so browser QA cannot verify saved controls from the fixture. | Result shows "not saved to history, cloud sync, or training review." | Add a local QA seed route or test-only save toggle for production QA. |
| P1-008 | High | Cloud UI | UI can say cloud sync is ready even when end-to-end verification fails. | Early Access showed cloud ready; verifier failed anonymous sign-in. | Add runtime cloud health state: configured, auth-ok, storage-ok, RLS-ok, last verified. |
| P1-009 | High | Copy/content | Early Access says cloud sync is ready but form copy says backend sync comes later/local-only. | Browser snapshot. | Make cloud copy state-driven and non-contradictory. |
| P1-010 | High | Database shape | `scan_lookups` stores result JSON but no separate model-run metadata table. | Migration inspection. | Add model run metadata after P0 cloud auth is fixed: provider, model, latency, prompt version, error code, OCR used. |
| P1-011 | High | Dataset quality | Cloud dataset persistence is still blocked even though local retention/export improved. | `MAX_SAVED_LOOKUPS = 300`, `getDatasetExport()`, and `/history` export button now preserve local dataset records; `npm run verify:supabase` still fails. | Keep the local export as a fallback, but cloud dataset must preserve all synced scans with retention/export policy. |
| P1-012 | High | Corrections | Correction is plain text only, not structured enough for training. | `correction: string`. | Add corrected part/category/damage severity/region fields in cloud review layer. |
| P1-013 | High | Visual search | Upload-from-gallery exists, but Lens-style screenshot/share-sheet input is not covered yet. | `GalleryScanButton` accepts JPEG/PNG/WebP and scanner tests cover upload while camera is blocked. | Add screenshot/share intent handling after the core camera and cloud gates are stable. |
| P1-014 | High | OCR | OCR is label-rescue only and invisible to the user. | Code path appends OCR text as evidence. | Show extracted label text as a source/evidence item and allow correction. |
| P1-015 | High | Eval | Beta release eval is fixed at 50 cases, but public-launch confidence still needs a larger 300-case set. | `npm run eval:identify:release` passed 50 fixed samples. | Expand the release eval set to 300 with accuracy, invalid response rate, latency, safety false-positive rate. |
| P1-016 | High | Scanner auto-capture | Auto scan now requires reticle overlap and a stable 5-second hold, but it still needs real camera/video-frame QA before public launch. | `useObjectTarget` resets hold outside the scanner box; `src/hooks/useObjectTarget.test.tsx` covers outside, inside, and leave/reenter behavior. | Run a real mobile camera/video-frame pass with engine-bay and exterior part images and tune overlap thresholds if needed. |
| P2-001 | Medium | Desktop layout | App is mobile-width centered on desktop with large empty side gutters. | Browser screenshot. | Keep mobile-first but add useful desktop panel layout: image left, result sheet right. |
| P2-002 | Medium | Screenshot/render | Full-page screenshot repeats fixed header and image sections awkwardly. | Browser full-page capture. | Review fixed positioning and print/export capture behavior. |
| P2-003 | Medium | History | History has dataset export but no filter/search/import controls. | `/history` exports dataset JSON from local saved scans. | Add filters by category/status/confidence and an import path after cloud baseline. |
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
