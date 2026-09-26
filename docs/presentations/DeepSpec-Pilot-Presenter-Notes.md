# DeepSpec parts-seller pilot

Eight-slide presentation prepared September 26, 2026. Audience: a prospective parts seller considering one supervised, unpaid pilot. The deck is a proposal, not a production launch announcement. No observed time savings, pricing validation or seller commitment is claimed.

## Slide outline and presenter notes

1. **DeepSpec: a small trial for parts intake.** Introduce photo-assisted part identification and a separate human inspection record. The cover uses the existing AI-generated alternator artwork as illustration, not customer evidence.
2. **What the trial will test.** Ask whether a seller can document a part with less staff time. Keep the operator's normal identity verification and functional checks in both workflows.
3. **AI suggestions and human checks.** DeepSpec suggests an identity from the photo. A person checks it against a label or reference and records visible condition and any actual test. A photo does not prove functionality or safety. No 3D, hidden-defect or custom-model claim.
4. **Inspection draft recovery.** The current review build keeps an unfinished draft in account-scoped browser storage. After reload, the operator chooses restore or discard. A newer saved inspection blocks restoring the old draft. Manual export provides a comparison path. Browser storage may fail or be cleared and is not a cloud backup. The screenshot uses fictional QA data and controlled cloud failures.
5. **A small supervised trial.** One seller, one operator, one part family. Rehearse first, collect ten manual baseline observations, then a separate twenty-part comparison batch with ten manual and ten assisted observations. Use distinct physical parts, balance difficulty and retain failed or abandoned attempts.
6. **Proposed continuation target.** At least 30% lower median active time is a proposed target, not a result. Check wrong accepted identities, lost records, completion, missing timing, support effort and observed service costs. Required functional-test time remains included. A tiny feasibility study cannot establish population-level accuracy or causal business impact.
7. **Before a seller begins.** The production inspection column, live persistence/isolation verification, configured and passing CI, and actual-phone rehearsal remain gates. Browser QA and local tests do not prove production readiness. Keep one editor because cross-device writes lack atomic conflict protection.
8. **Pilot invitation.** Ask to observe the seller's intake process and agree on a small supervised comparison. The seller selects the part family and approves photo storage. Discuss paid continuation only after showing actual results. Training and public sharing need separate permission. No outreach was sent.

## Sources and provenance

- `docs/PILOT_RUNBOOK.md`: protocol, target, stop conditions and seller invitation.
- `docs/PRIVATE_BETA_RELEASE_CHECKLIST.md`: migration, configuration, isolation and device release gates.
- `docs/DRAFT_RECOVERY_RELEASE_REPORT_2026-09-26.md`: current implementation and verification evidence.
- `src/components/result/PartInspectionForm.tsx` and `src/services/inspectionDraft.ts`: actual draft behavior.
- `docs/UI_POLISH_2026-09-21.md` and `public/brand/alternator-workbench.webp`: previously generated decorative artwork and provenance.
- `artifacts/qa/2026-09-26T16-20-49-881Z/screenshots/inspection-stale-recovery-choice.png`: actual screenshot with fictional QA records. The slide retains the original embedded image and crops to its relevant upper region. Local artifacts remain outside Git.
- Implementation review: https://github.com/om1o/DeepSpec/pull/114, published code head `8dce4d989be5badcb71e21f13a927be7d36e96e1` when the deck was prepared.

All slide text and notes are editable. The two embedded images are raster assets. Source notes are repository-relative. The deck was exported with Artifact Tool, passed package/layout/font/import checks and underwent slide-by-slide rendered review. It was not opened in native PowerPoint.
