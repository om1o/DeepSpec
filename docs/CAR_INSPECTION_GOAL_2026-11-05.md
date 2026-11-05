# DeepSpec car inspection goal

Product promise: walk around your car, understand what is visible, document concerns, and leave with a useful next step. The full twelve-part objective remains open until the implementation and real-world acceptance evidence below exist. A valuation or “10x better” claim is not an engineering test result.

## Requirements and evidence ledger

| # | Required outcome | Acceptance evidence | Current status |
|---|---|---|---|
| 1 | Engine-bay overview connected to every selected component; inspected / needs another view / not visible states | Real cluttered-bay journey; unseen components never marked inspected; reopen preserves map | Existing scene recognition and puzzle view; durable inspection map pending |
| 2 | User-directed overview, close-up, marking and mounting photos grouped to one part; contradictions explained | Real multi-file upload, labeled provider payload and answers using each image; reopen retains every photo | Draft implementation accepts 1–4 labeled photos and carries the whole group through identify, fallback and chat; integrated CI and hosted acceptance pending |
| 3 | Original / Outline / Cutout; corrected selections; honest crop fallback; every component survives reopen | UI, geometry and persistence tests plus browser/device inspection of actual masks | Draft controls and persistence implemented; review fixes invalidate stale cutouts and preserve corrections; final integration, browser correction flow and real-mask acceptance pending |
| 4 | Rust/damage observations, possible cause and unknown severity separated; missing evidence requested | Adjudicated rust/crack cases across structural and cosmetic areas, with counterexamples | Existing uncertainty fields; dedicated workflow pending |
| 5 | Confirmed year/make/model/engine/mileage/modifications shared across inspections and chat | Vehicle edit/reopen/account isolation and uncertain-context tests | Existing shop context; owner vehicle workflow pending |
| 6 | Important claims trace to image/region/source; observation, explanation and confirmed inspection distinguished | Tap-to-evidence UI; no false “confirmed” claims; calibration on held-out labeled examples | Coarse scene regions exist; precise traceability/calibration pending |
| 7 | One specific next evidence request explains what it resolves | Scenario tests and user completion without repetitive generic prompts | Existing nextAction; linked evidence workflow pending |
| 8 | Verified vehicle-specific diagrams/specifications/procedures with visible sources | Licensed/authorized source access, exact vehicle match, source/version shown | Reference links exist; deeper licensed integration pending |
| 9 | Import OBD reports and connect codes/readings to photographed systems; adapter support later | Supported report fixtures, original retained, code never equated with failed part; adapter/device tests | Pending |
| 10 | Dated same-area comparisons with angle/lighting caveats | Revisit original location, compare actual photos, no unsupported numerical growth estimate | Pending |
| 11 | Mechanic handoff with symptoms, annotations, measurements, unknowns and recorded corrections/repair | Export and mechanic review round trip preserving evidence and authorship | Existing intake/inspection forms; integrated handoff pending |
| 12 | Photos saved before analysis; interrupted upload recovery; connection loss and clear retries; actual iPad acceptance | Reload/offline/quota/account-switch tests, cloud restore, physical device acceptance | Native IndexedDB draft save/reload/account isolation checked; upload/camera recovery and clear retries implemented in draft; full offline queue and physical iPad acceptance pending |

## Delivery sequence

1. Labeled photo groups, checkable puzzle isolation, durable selected evidence and interruption recovery.
2. Component inspection map, rust/claim evidence, vehicle confirmation, targeted next checks and mechanic handoff.
3. Authorized reference integration, OBD report import, dated comparisons and compatible adapter work.
4. Real owner/mechanic and iPad acceptance; measure time saved, missed components, incorrect claims, successful handoffs and repeat use. Fix failures before release claims.

This ordering is staging, not a reduced definition of completion. No item is complete merely because tests pass or code is deployed. Hosted acceptance and access-dependent work stay explicitly open.

## Sources and constraints

- [Gemini image understanding](https://aistudio.google.com/docs/image-understanding): labeled multiple image parts; enforce the app's smaller total request budget and never silently drop angles on fallback.
- [Supabase changelog](https://supabase.com/changelog): checked 2026-11-05; CLI v3 changes hosted targeting/confirmation. Check actual installed CLI before schema work. Current browser client work does not require a CLI upgrade.
- [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control): private owner-scoped evidence and explicit upload permissions.
- [ALLDATA Repair](https://www.alldata.com/us/en/repair): OEM reference candidate; product subscription is not permission to redistribute its content.
- [Car Scanner](https://www.carscanner.info/): diagnostic-data workflow reference; establish supported import formats before advertising compatibility.
- [DVSA structural integrity and corrosion guidance](https://www.gov.uk/guidance/mot-inspection-manual-for-private-passenger-and-light-commercial-vehicles/appendix-a-structural-integrity-and-corrosion): corrosion assessment depends on component, mounting and load-bearing context. The prompt no longer blanket-classifies rocker panels as cosmetic. This UK inspection guidance is context, not a universal legal standard or a photo-only diagnosis.
- [Groq vision documentation](https://console.groq.com/docs/vision): the current default Qwen vision route accepts at most three images. Four-photo groups preserve all images through a capable configured fallback or return an explicit unsupported-count error; no silent truncation.

## Foundation validation record

The photo/evidence foundation is a draft, not a completed twelve-part product or a new hosted AI benchmark.

- Native browser integration used the actual IndexedDB service with two synthetic images. Both labels and exact image data survived reload; a second account could not read the first account's draft. Synthetic records and the temporary harness were removed.
- After the transaction hardening, 12 additional native IndexedDB checks passed at 2026-11-05T07:26:39.357Z: insert-if-empty, concurrent matching replacements with exactly one winner, stale edit/analysis/discard protection, current-group verification, account isolation and matching capture retirement. Synthetic records were removed. Scanner regressions for these paths still require integrated CI.
- A separate local component fixture loaded the new photo review and puzzle controls. Relabeling a photo and selecting a component worked. Browser command/screenshot timeouts prevented complete correction-flow and visual acceptance. These fixture interactions sent no AI requests and are not hosted-app evidence.
- A disposable PGlite fixture validated the evidence migration, owner restrictions, revision conflicts, legacy SQL NULL, and rejection of absent/null/string/unsupported versions or malformed containers. It is not full Supabase or a hosted migration. Report timestamp: 2026-11-05T06:57:26Z. Migration SHA-256: `4ea3d27102af71381ff8ec3bf6eb1622e9eae55ac5d7691915f75ce483e30001`.
- Earlier slice checks passed backend photo cases, cloud persistence cases, UI cases and type/lint checks. They do not cover all later fixes. A combined local rerun passed eight utility cases but failed to start six other thread workers; a two-suite fork retry failed before collecting tests. Those are runner errors, not passing tests or established app failures. Final integrated CI and build must be recorded before release.
- No credentials changed, hosted schema changed, deployment created, auth bypass restored, or real payment made for this foundation.

Next release checks: current-head CI, full correction/reopen flow, actual multi-photo uploads and follow-up answers on an approved Preview, physical iPad capture, and cloud restoration with the approved evidence migration. Record exact deployment commit, provider/model and original answers again.

## Baseline and release boundaries

GitHub PR #126 was inspected on 2026-11-05: open/draft, head `be3b70d8e7c8629c62aa86648d5829f8ca0c8a66`, tree `6391af017ce709dd9eb82ef27f546cc6150782bf`. This worktree starts at local `ad6d4215fc94778e479dd5d98d167be1f8fe6fd9`, the identical tree. The previous three-photo live benchmark established a working Gemini connection, not current accuracy, calibrated probabilities, physical iPad support or multi-photo support.

Development branch: `codex/car-inspection-evidence-20261105`; Vercel Git deployment disabled in its config. Keep server keys server-side. Prepare tested changes and a concrete deployment/database proposal before the user's required hosted approval. Never restore the removed test-auth bypass. Production promotion, commercial commitments, paid data licensing and a company valuation are not implied by a source commit.
