# DeepSpec — Maker Portfolio project plan

Status: working plan, not a completed experiment or an application essay.
Prepared September 20, 2026 for an undergraduate MIT Maker Portfolio.
DeepSpec is an independent project; it is not affiliated with MIT.

## Project purpose

Build and investigate a camera interface that helps a person identify a selected
automotive component in a cluttered scene. Component identification does not
establish exact vehicle compatibility, mechanical condition, or repair safety.

The creator's personal motivation and individual contributions must be supplied
and confirmed by the creator, not inferred from Git history or written for them.

## First engineering question

Does isolating a user-selected component improve identification compared with
sending the full image, and is any improvement worth the extra latency?

Hypothesis: isolation may reduce distraction, but removing surrounding context
or selecting an incorrect mask may make identification worse. Either outcome
is useful if measured and reported honestly.

## Experiment 1: controlled comparison

Compare the same target in three conditions:

1. Full image with the selected target indicated.
2. Bounding-box crop of that target.
3. Segmented target produced by DeepSpec's existing isolation pipeline.

Keep the identification model/version, prompt instructions, target indication,
output schema, and generation settings fixed where supported. Record any
unavoidable differences. Distinguish this experiment from end-to-end system
evaluation; it does not prove a general advantage over another AI product.

Start with a small development set to verify the harness. Then use a separate
held-out set: a proposed initial target is 40 physical components with three
views each. This is a feasibility study, not a statistically representative
automotive benchmark. Group splits by physical component and donor vehicle;
never put alternate views of the same component into both sets.

Use permissioned photos and document their origin and permitted uses. Have a
knowledgeable reviewer confirm labels and acceptable synonyms before scoring.
Include clutter, occlusion, rotation, similar-looking parts, and unreadable
markings. Do not label a component by trusting another model's answer alone.

Record per case:

- Correct component category/name, wrong answer, or abstention/retake request.
- Coverage and correctness among answered cases; report confidently wrong cases.
- Target-selection/mask failures, separately from identification failures.
- Capture-to-answer time, including preprocessing; report median and p95.
- Provider errors, model/configuration, requests, and estimated API cost.

Keep every attempted case, including failures. Freeze scoring rules before the
held-out run. Show paired examples where isolation helps and where it hurts.
Do not tune on the held-out set and then present it as untouched evaluation.

## Existing evidence and open work

The September 20 verification recorded 66 test files and 742 passing tests,
plus passing lint and production build. See CONTINUATION_2026-09-20.md.
Those checks establish software behavior, not field identification accuracy.

Existing code includes an identification evaluation script and synthetic mask
selection/geometry tests. Review their scoring and extend only what Experiment 1
requires. Real-camera SAM behavior, rotation, and other parked device checks
remain unverified. No new accuracy or time-saving result is claimed here.

## Build notebook and authorship

For each meaningful iteration record: date, problem, proposed change, who did
what, test method, result, failure evidence, and next decision. Retain original
screenshots, diagrams, recordings, and experiment outputs.

Separate the creator's design, implementation, testing, and interpretation from
AI-generated code, collaborator work, third-party models, and libraries. Verify
licenses and attribution before redistributing assets. Do not claim model
training, algorithm invention, or independent implementation that did not occur.

The creator should be able to explain the image-to-answer pipeline, why a mask
can select the wrong object, how stale asynchronous responses are prevented,
and what the tests do and do not prove. These are learning goals, not assertions
about current knowledge or personal authorship.

## Sequence

1. Confirm personal motivation and contribution history; collect existing evidence.
2. Define the evaluation labels, dataset permissions, and scoring protocol.
3. Verify the harness on development images before running held-out experiments.
4. Diagnose the most frequent measured failure; make and verify one change.
5. Run a small permissioned user study after the scanner is reliable enough.
6. Assemble a concise portfolio with a reproducible, accessible demonstration.

## Submission reference

MIT's current guidance emphasizes process documentation and clear explanations,
allows work in progress when identified, and requires a codebase and working demo
for code projects. The current limits are up to 25 media attachments and no more
than two minutes of video across the entire Maker Portfolio. These are ceilings,
not targets. Recheck the official instructions for the actual application cycle.

Source checked September 20, 2026:
https://mitadmissions.org/apply/firstyear/portfolios-additional-material/

This plan is preparation guidance, not a prediction of admission.
