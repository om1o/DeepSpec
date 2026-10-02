# DeepSpec full product presentation

Current deck: [`DeepSpec-Full-Product-V1-Tester-Edition.pptx`](DeepSpec-Full-Product-V1-Tester-Edition.pptx). It is an October 2026 private-beta edition, not a public-launch or investment claim.

## 1. DeepSpec

DeepSpec is now a private-beta candidate: photograph a vehicle part, review an AI suggestion, ask focused follow-ups, mark the answer right, wrong or unresolved, and keep the photo, answer and human feedback together. Public launch still depends on provider evaluation, physical-phone checks, monitoring and real tester evidence. The cover uses existing original AI-generated brand artwork, not a customer scan.

Sources: `docs/V1_LAUNCH_PLAN.md`, `docs/V1_CREATIVE_RESEARCH_2026-10-01.md`, `src/screens/Result.tsx`, `src/screens/EarlyAccess.tsx`, `public/brand/alternator-workbench.webp`

## 2. When a part is unfamiliar

These are product hypotheses, not claims from an industry survey. They apply to a person trying to understand a component as well as to seller intake. DeepSpec should observe real users before quantifying prevalence, time lost or return-rate impact.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `docs/PILOT_RUNBOOK.md`, `docs/PART_INSPECTION_PILOT.md`

## 3. People DeepSpec can help

These are intended-use cohorts, not customer counts or validated demand. DeepSpec should not compete as a generic visual search tool or OEM catalog. Its V1 wedge is a reviewable record: photo, AI suggestion, visible clues, focused follow-up and human feedback kept together. Experienced mechanics may use it for documentation, teaching and handoff even when they already know the part.

Sources: `docs/V1_CREATIVE_RESEARCH_2026-10-01.md`, `src/screens/Shop.tsx`, `https://support.google.com/websearch/answer/1325808?hl=en`, `https://docs.partium.io/partium-find/partium-search-engine/how-partium-image-part-search-works/`

## 4. The core DeepSpec workflow

The workflow combines scanner capture and results with human inspection metadata and saved history/report tools. Save state distinguishes device persistence from successful cloud receipt. Cloud behavior depends on configuration and connectivity.

Sources: `docs/PART_INSPECTION_PILOT.md`, `src/screens/Scanner.tsx`, `src/screens/Result.tsx`, `src/screens/History.tsx`, `src/services/report.ts`

## 5. Photo capture and the AR experience

The scanner accepts camera and upload input, assesses capture quality and can focus/isolate a selected region. Segmentation service availability affects isolation; do not claim guaranteed segmentation or 3D reconstruction. This is a two-dimensional image workflow. A clearer photo can aid review but does not guarantee identification accuracy.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `src/screens/Scanner.tsx`, `src/lib/imageQuality.ts`, `src/lib/promptableSegmentation.ts`

## 6. AI result with focused follow-ups

The screenshot is a current local QA capture of the result page. The result keeps a focused follow-up field beside the evidence and stores the conversation with the scan. Answer depth may vary from 9 to 25 sentences based on complexity. It remains an AI suggestion, not proof of function, safety, fitment or hidden condition.

Sources: `src/screens/Result.tsx`, `src/services/resultChat.ts`, `src/services/storage.ts`

## 7. Human checks stay separate

DeepSpec stores human inspection fields separately from AI output. The form requires inspector name, identity evidence when identity is provided, notes for visible damage/uncertainty, and a method/result when a functional status has been selected. Inspector identity is self-reported. These records are not safety certification or validated training labels.

Sources: `docs/PART_INSPECTION_PILOT.md`, `src/components/result/PartInspectionForm.tsx`, `src/lib/partInspection.ts`

## 8. An interruption need not lose the notes

The screenshot shows fictional QA input in the actual application. Draft recovery is scoped by signed-in account and scan on the device. Restore and discard are explicit. If the saved inspection changed, restoration is blocked and the user can download old notes. The app warns when storage fails and keeps visible typed text. This guard does not provide atomic cross-device conflict resolution.

Sources: `docs/DRAFT_RECOVERY_RELEASE_REPORT_2026-09-26.md`, `src/services/inspectionDraft.ts`, `src/components/result/PartInspectionForm.tsx`, `artifacts/qa/2026-09-26T16-20-49-881Z/screenshots/inspection-stale-recovery-choice.png`

## 9. A library that keeps the evidence close

Saved history supports search, categories, review states, ratings and an unresolved-identity filter. The screenshot contains synthetic QA records with unavailable photos, not real customer inventory. Library export offers JSON; individual text report export includes human inspection fields and private notes, so review before sharing. Device success and cloud success remain distinct.

Sources: `src/screens/History.tsx`, `src/services/report.ts`, `artifacts/qa/2026-09-21T13-42-31-354Z/screenshots/saved-history.png`

## 10. Shop jobs and customer reports

Shop mode supports local job/customer/vehicle context, linked scans and generated customer reports. It does not currently provide a shared live multi-employee database or automatic catalog/order integration. This is an intended application within the product, not proof that a shop already adopted it.

Sources: `src/screens/Shop.tsx`, `src/services/shop.ts`, `src/services/report.ts`

## 11. Accounts, storage and control

Account-scope generation guards prevent stale asynchronous activity from applying to another account. Local device data still uses browser storage and is not a guarantee against a compromised device. Existing authentication and cloud pathways require release verification. The live inspection verifier now passes save/read/update and account isolation after the additive migration. No automatic training ingestion is claimed.

Sources: `src/lib/accountScope.ts`, `src/services/storage.ts`, `src/services/cloudSync.ts`, `src/services/inspectionDraft.ts`, `artifacts/qa/v1-foundation-2026-09-26/cloud-inspection.txt`, `docs/V1_LAUNCH_PLAN.md`

## 12. What time savings could be worth

Illustrative arithmetic only. Assume 30 parts/day × 22 working days/month = 660 parts/month. Assume ordinary intake including required tests takes 6 minutes manually versus 4.5 minutes assisted. (6 - 4.5) × 660 / 60 = 16.5 hours/month. At an assumed $30/hour this is $495 of modeled gross labor capacity before setup, support, software or other costs. It is not cash savings, revenue, profit, a price recommendation, or a seller measurement. Actual values must come from observation. Editable chart contains literal hypothetical data.

Sources: `docs/PILOT_RUNBOOK.md`

## 13. Who might pay, and for what

These audiences and pricing structures are hypotheses, not current offers, revenue or customer commitments. Do not infer willingness to pay from the hypothetical time calculator. Observe usage, support burden, model costs and the buyer’s own alternatives, then ask whether they would continue at a concrete proposed scope and price.

Sources: `docs/PILOT_RUNBOOK.md`

## 14. Evidence behind the beta build

This slide reports current branch evidence, not public-launch proof. Focused tests, lint and production build pass. The public tester page and right/wrong/unresolved result review were checked in a real browser at mobile and desktop widths. The live Supabase constraints accept all three review states. Real identification accuracy, real-user usefulness, physical-phone behavior and production monitoring remain release gates.

Sources: `docs/V1_CREATIVE_RESEARCH_2026-10-01.md`, `src/screens/EarlyAccess.test.tsx`, `src/screens/Result.test.tsx`, `supabase/migrations/20261002012446_add_unsure_scan_rating.sql`

## 15. V1 is now a private-beta candidate

Current means implemented and verified on the review branch, not publicly launched. The tester program, focused follow-up, explicit unresolved feedback and opt-in training consent are built. Public launch still requires a labeled automotive provider evaluation, physical iOS and Android checks, actual tester observations, monitoring, cost controls, access controls and rollback evidence.

Sources: `docs/V1_LAUNCH_PLAN.md`, `docs/PRIVATE_BETA_RELEASE_CHECKLIST.md`, `docs/PRODUCTION_READINESS_GOAL_PLAN.md`, `src/screens/EarlyAccess.tsx`, `src/screens/Result.tsx`

## 16. A four-stage route to V1 evidence

The product is ready for controlled private-beta preparation, not public launch. Recruit 5–15 founding testers across DIY, trainee, mechanic, seller and shop workflows. Each tester scans 10 real parts, judges every result as right, wrong or unresolved, sends at least three useful notes and reopens records to verify persistence. The reward is free beta access plus six months after paid launch for accepted testers who complete the checklist.

Sources: `docs/V1_CREATIVE_RESEARCH_2026-10-01.md`, `src/screens/EarlyAccess.tsx`, `https://support.google.com/googleplay/android-developer/answer/14151465?hl=en`

## 17. Feedback that can support V2

The capture path is live: users can mark a result right, wrong or unresolved, add a correction when known, submit categorized feedback and separately opt a scan into future review. Those records still require review before dataset approval. No upload automatically enters model training.

Sources: `src/screens/Result.tsx`, `src/screens/EarlyAccess.tsx`, `src/components/result/TrainingConsentPanel.tsx`, `src/lib/intakeReview.ts`, `supabase/migrations/20261002012446_add_unsure_scan_rating.sql`

## 18. The DeepSpec vision

The immediate objective is evidence, not revenue or scale. Run the founding tester program, measure right/wrong/unresolved outcomes, record failure patterns and verify the app on real phones. Public launch should follow only after repeated failures are fixed and the release gates are satisfied. Do not promise verified function, hidden damage detection, fitment, valuation accuracy, revenue or measured time savings.

Sources: `docs/V1_LAUNCH_PLAN.md`, `docs/PRIVATE_BETA_RELEASE_CHECKLIST.md`, `docs/V1_CREATIVE_RESEARCH_2026-10-01.md`, `public/brand/deepspec-logo.png`
