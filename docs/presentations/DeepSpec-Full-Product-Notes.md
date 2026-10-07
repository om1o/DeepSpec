# DeepSpec full product presentation

## 1. DeepSpec

The V1 aim is to let someone photograph an automotive part, receive an AI identification suggestion and useful information, inspect the result, and easily report or correct problems. Human inspection records add traceable evidence for seller and shop workflows. Actual time savings and real-user accuracy remain unmeasured. The cover uses existing original AI-generated brand artwork, not a customer scan.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `docs/PART_INSPECTION_PILOT.md`, `docs/PILOT_RUNBOOK.md`, `public/brand/alternator-workbench.webp`, `docs/UI_POLISH_2026-09-21.md`

## 2. When a part is unfamiliar

These are product hypotheses, not claims from an industry survey. They apply to a person trying to understand a component as well as to seller intake. DeepSpec should observe real users before quantifying prevalence, time lost or return-rate impact.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `docs/PILOT_RUNBOOK.md`, `docs/PART_INSPECTION_PILOT.md`

## 3. People DeepSpec can help

Audience roles are intended uses, not existing customer counts. Seller intake is one candidate workflow in the broader trusted-user beta. Shop mode currently stores jobs locally for the account/device, rather than providing a live shared workspace. DIY users should treat AI output as a starting point and seek appropriate human checks.

Sources: `docs/PILOT_RUNBOOK.md`, `src/screens/Shop.tsx`, `src/services/shop.ts`

## 4. The core DeepSpec workflow

The workflow combines scanner capture and results with human inspection metadata and saved history/report tools. Save state distinguishes device persistence from successful cloud receipt. Cloud behavior depends on configuration and connectivity.

Sources: `docs/PART_INSPECTION_PILOT.md`, `src/screens/Scanner.tsx`, `src/screens/Result.tsx`, `src/screens/History.tsx`, `src/services/report.ts`

## 5. Photo capture and the AR experience

The scanner accepts camera and upload input, assesses capture quality and can focus/isolate a selected region. Segmentation service availability affects isolation; do not claim guaranteed segmentation or 3D reconstruction. This is a two-dimensional image workflow. A clearer photo can aid review but does not guarantee identification accuracy.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `src/screens/Scanner.tsx`, `src/lib/imageQuality.ts`, `src/lib/promptableSegmentation.ts`

## 6. AI result and follow-up chat

The screenshot records a live engine-image QA response on September 26. It is a feature example, not a measured identification-accuracy study. Results and follow-up chat can contain errors. A separate result chat lets users ask about the scan. Scan upload cloud receipt in the screenshot does not prove the new human-inspection cloud column exists.

Sources: `artifacts/qa/2026-09-26T11-35-19-272Z/screenshots/scanner-ai-engine.png`, `artifacts/qa/2026-09-26T11-35-19-272Z/report.md`, `src/screens/Result.tsx`, `src/screens/Chat.tsx`

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

## 14. Evidence behind the current build

Counts refer to the recorded review-branch implementation, not every future commit. The 1,015 tests plus lint/build evidence is historical. Browser recovery checks used controlled cloud failures. A later live verifier, after the existing additive inspection migration, passed inspection save/read/update, original AI/evidence retention, second-account read/write denial, private image access isolation and generated fixture cleanup. This supersedes the earlier missing-column blocker. Production email authentication, physical-phone testing and real-user usefulness remain separate release checks.

Sources: `docs/DRAFT_RECOVERY_RELEASE_REPORT_2026-09-26.md`, `artifacts/qa/v1-foundation-2026-09-26/cloud-inspection.txt`, `docs/V1_LAUNCH_PLAN.md`, `artifacts/qa/2026-09-26T11-35-19-272Z/report.md`, `https://github.com/om1o/DeepSpec/actions/runs/36255542250`, `https://github.com/om1o/DeepSpec/pull/114`

## 15. A focused V1, with room for V2

Current means implemented in the reviewed prototype, not publicly launched. Live inspection persistence now passes the cited verifier. Structured feedback categories, review infrastructure and explicit per-example consent/lineage remain planned or in review until their implementation passes verification. Existing ratings and corrections are a starting point. V1 should not wait for custom model training or full 3D reconstruction.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `docs/V1_LAUNCH_PLAN.md`, `artifacts/qa/v1-foundation-2026-09-26/cloud-inspection.txt`, `docs/DRAFT_RECOVERY_RELEASE_REPORT_2026-09-26.md`, `docs/PART_INSPECTION_PILOT.md`, `src/screens/Shop.tsx`, `src/services/cloudSync.ts`

## 16. A one-month route to real users

This is the user’s approximately one-month target, governed by readiness rather than a guaranteed deadline. V1 should serve a broader group of 5–15 trusted users. Measure scan success, wrong identifications, corrections, AR failures, latency, crashes and usefulness. One seller can form a focused cohort using the existing separate 10-observation baseline and 20-part comparison protocol. The pilot’s 30% time reduction threshold remains a proposed test target, not a product claim. Keep normal tests in both seller workflows.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `docs/V1_LAUNCH_PLAN.md`, `docs/PILOT_RUNBOOK.md`

## 17. Feedback that can support V2

The pipeline is the current product plan, not a claim that a full review dashboard and versioned dataset system already exist. Preserve both good and bad outputs when permitted. A useful wrong-part correction may be valuable, but incorrect corrections, faces, plates and private details require filtering and review. Keep explicit consent, provenance, review status and dataset lineage. Honor opt-out/deletion through the eventual lineage system. Evaluate improved prompts, retrieval, routing and preprocessing before committing to custom training.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `docs/V1_LAUNCH_PLAN.md`, `docs/PART_INSPECTION_PILOT.md`, `src/services/trainingReadiness.ts`, `src/services/shop.ts`

## 18. The DeepSpec vision

The user’s V1 purpose is to help people photograph a car part and better understand what it might be, with useful information and a clear way to inspect/report/correct the answer. Seller and shop documentation are meaningful applications within this broader purpose. The next step is focused reliability and AR/feedback polish, followed by 5–15 real testers. Do not promise verified function, hidden damage detection, fitment, valuation accuracy, revenue or measured time savings.

Sources: `docs/V1_V2_MASTER_PLAN.md`, `docs/V1_LAUNCH_PLAN.md`, `docs/PILOT_RUNBOOK.md`, `public/brand/deepspec-logo.png`
