# Evidence limits after the November 7 live benchmark

The PR #172 Preview returned two real Gemini scans and four follow-up answers. Its
successful requests did not establish answer quality. The three-photo answer called
surface damage severe without establishing depth or structural effect. Both next-check
answers bundled several actions despite a request for one per photo. One claimed dye
penetrant would establish crack depth and severity. The two-photo scan omitted a
photo-linked engine condition finding, although a generic engine description existed.

This change updates shared identify/chat instructions to distinguish visible extent
from severity, state measurement limits, request exactly one targeted next check per
requested photo, and prioritize supported photo-linked findings over optional detail.
It preserves missing coverage as missing; it never manufactures healthy observations.
The pipeline version is explicitly recognized as retaining first-photo identity scope.

## Technical basis

- [TWI: principles of penetrant examination](https://www.twi-global.com/technical-knowledge/faqs/faq-what-are-the-principles-of-penetrant-examination-in-non-destructive-examination-nde)
  describes detection of discontinuities open to the surface.
- [TWI: factors affecting penetrant indications](https://www.twi-global.com/technical-knowledge/faqs/faq-what-influences-the-flaw-entrapment-efficiency-of-a-penetrant-inspection)
  explains that geometry, contaminants, processing and penetrant behavior affect the
  indication. An indication is not a direct crack-depth measurement or a serviceability decision.

These are general method limits, not an automotive wear specification. No numeric
rotor limit, tightening torque, account credentials or provider changes are included.

## Validation and remaining live acceptance

Mocked API tests inspect the actual outgoing request for ordinary and research chat,
including all three original photos. They verify instruction transport, not Gemini's
compliance. A new live run must independently show one targeted check per requested
photo, explicit unresolved depth/strength, no invented specifications, and honest
missing coverage. Reuse of the old benchmark is not proof this version works.

## Isolation investigation

The tested build saved crops, not precise masks. Both local segmenters require WebGPU.
Scanner allows three seconds for primary isolation and one second for scene masks,
while SAM has longer internal load/inference deadlines. Cold loads can therefore be
discarded by the caller. The saved benchmark lacks the diagnostic evidence needed to
attribute its fallback to that timeout, GPU support, model download or mask rejection.
No precise-isolation success is claimed by this change. A separately tested explicit
retry after the crop is displayed is preferable to delaying every initial AI scan.

## Selected part continuity — November 16

The selected-part handoff fits the existing scanner/result/chat flow. It adds no visual
animation or effects and retains the cutout, late-WebGPU and runtime-asset fixes from
`c93f5fc` (`9a88f2d` included). The separate
`codex/selected-part-followup-20261116` branch also disables automatic deployment.
This addresses result-level ask/refine item P1-006 and image-linked evidence item P1-004
in [the existing production-readiness plan](PRODUCTION_READINESS_GOAL_PLAN.md).

Before this change, scan requests sent an original and optional crop without the selected
region. Follow-ups sent saved images without that region. A tapped object's separate
analysis existed only in scanner state and could not open its own conversation. Two
client transport regressions, fourteen server regressions and a scanner handoff regression
failed before their respective fixes. Persistence regressions separately reproduced lost,
invalid and stale selection references.

Requests and saved evidence now retain `selectedPart`: the first original photo ID,
its normalized rectangle, and an optional explicitly linked crop ID. Coordinates remain
on the original; the linked crop supplies detail, not a new camera angle. Invalid references
fail before inference or saving. Ordinary and research follow-ups carry the reference
outside capped conversation text. A selected-only request cannot reuse an overview-only
cache entry. Unlocalized whole-photo OCR is skipped for selected requests rather than
being appended as the selected component's label evidence.

After explicit selected-area analysis, Ask DeepSpec saves/reuses a separate ordinary
lookup with the exact analyzed original, crop, selection and result. Its conversation is
separate from the overview. Correction, save/reopen, cloud metadata, stale-result and
account/late-response checks retain those boundaries. The existing evidence JSON format
accepts the optional metadata; no database migration is required.

Provider instructions ask for a visible clue, retain markings on their visible owner,
allow literal transcription without claiming verified OEM identity/fitment, and request
one straight-on focused label close-up if the selected component's number is unreadable.
These instructions do not establish model compliance.

Local verification used the committed generated `engine-scan-test.jpg`, SHA-256
`799c53e3793796f5854da01e5144a7408d8864fc3ebbd61c33f043c8f78c42df`.
It is not the missing weathered-alternator benchmark. A real Chromium browser created a
crop, saved/reopened Chat between “What part is this?” and “Can you tell its part number?”,
and submitted three requests through the actual client and final provider request builders.
All three retained the identical target, two photo IDs and original-image hash; browser
errors were empty. Provider replies were intercepted fixtures. Evidence is local in
`artifacts/qa/selected-part-20261116/`, including `browser-check.mjs`,
`browser-summary.json` and `chat-tablet-local.png`. The committed
`src/services/selectedPartFlow.test.ts` reproduces actual request construction with the
original fixture bytes and a persisted/reopened selection without contacting a provider.
The final local `npm run check` passed all 4,314 tests in 206 files, lint, strict/non-strict
server compilation, frontend compilation, production build and public/brand integrity.
The run used Node 24.22.1; repository CI uses Node 22. The build's regenerated intro files
were restored to the original tracked versions, and public/brand integrity passed again.

The original benchmark and reviewed held-out export remain unavailable. A read-only
November 16 query of Supabase `dataset_export_queue` returned no eligible cases. For the
72% top-choice checkpoint, attempted=0, correct=0, wrong=0, abstentions=0 and provider
failures=0: accuracy is **not measured**, not 0% and not passed. Existing 50/300-case release
thresholds and scoring are unchanged. Future before/after measurement must freeze the
same reviewed held-out photos/labels and score only the displayed top choice over all
attempts; alternatives/evidence text cannot rescue a wrong top choice. Keep the repaired
development example separate.

QA doctor still reports missing app/auth configuration; the controlled local browser
fixture is not authenticated hosted-app acceptance. No live inference, scan-credit change,
credential change, hosted migration, Preview deployment or Production promotion occurred.

Next iPad test on an authorized private Preview: select the alternator in the original
weathered photo, explicitly analyze its area, inspect the identification and visible clue,
then open Ask DeepSpec and ask both exact questions. Save/reopen before the second question.
Verify hose markings remain on the hose; an unreadable alternator number must request the
single focused label close-up. Record exact answers, source commit, provider/model and
request references. Precise masks and broader accuracy remain separate acceptance checks.
