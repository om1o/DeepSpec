# Six-hour real-parts rehearsal

Objective: complete the six-hour workflow proposed in the conversation, with real measurements, one evidence-driven improvement and a fresh-part repeat. These are work blocks, not a claim that six hours have elapsed or that any physical study is complete.

## Current completion audit

| Block | Required result | Current evidence and status |
| --- | --- | --- |
| 1: scope and samples | One selected family, operator, permitted physical parts/photos and independent identity references. | Incomplete. Family/operator availability requested. Repository has a generic engine QA fixture, not a verified starter/alternator study set. No real observation files found in `artifacts/pilot/`. |
| 2: manual baseline | Ten ordinary manual observations with active/elapsed time, functional checks, errors and interruptions retained. | Incomplete: needs an operator and physical parts. Empty template returns `no_observations`. |
| 3: assisted comparison | First balanced 20-part batch using distinct physical parts, ten manual and ten assisted, with all attempts retained. | Incomplete: depends on scope, permission and real timing. Follow the existing runbook; do not use AI output as ground truth. |
| 4–5: fix and verify | Identify the largest measured source of operator work, reproduce it, implement a focused fix and verify it. | Incomplete: no measured bottleneck yet. Measurement-tool preparation is complete, but does not fulfill this block. |
| 6: repeat and demonstrate | A separate balanced 20-part batch, comparison with limitations, and short demo of actual behavior. | Incomplete: no fresh-part repeat or measured improvement. |

If part availability or operator timing makes the batches exceed six hours, continue the study rather than shorten denominators or claim completion. A blocked hour is not a completed hour.

## Ready-to-use materials

- [Pilot runbook](PILOT_RUNBOOK.md): scope, permission, timing, identity judgment and observation fields.
- [Empty JSON template](pilot-observations.template.json): copy to ignored `artifacts/pilot/observations.json`, replace the study ID, and enter actual observations only.
- Summary command: `node scripts/pilot/summarize-intake-pilot.mjs artifacts/pilot/observations.json`.
- [Inspection rollout notes](PART_INSPECTION_PILOT.md): local inspection behavior and outstanding cloud migration.

Timing interruptions now remain in the machine-readable denominator: set all three timing fields to `null`, record `timingMissingReason`, and retain any partial values in the raw notes. Outcome, acceptance, identity and capture counts still require actual observations. Missing timing withholds the batch's time-reduction percentage. No estimated time, zero placeholder or synthetic test fixture substitutes for a measurement.

## Evidence to collect during the demo

Use a permitted development part, separate from held-out evaluation parts. Show capture, draft identity and missing evidence, operator correction if needed, separate visible-condition and functional-test fields, save/reload and text export. Show an unresolved example too. Keep original AI output distinct from human judgment. Label the demonstration device-only until the cloud migration and live verifier pass. Do not show customer identifiers, private catalog material or credentials.

The final report should state commit and device/browser, family and operator pseudonym, actual batch denominators, missing timing, completion/error counts, active/elapsed medians, the observed bottleneck and fix, fresh-part results, and remaining limits. The 30% time-reduction target is a hypothesis. Include a result below that target or a failed attempt without hiding it. No willingness-to-pay or MIT admission claim follows from this rehearsal.

## Preparation verification

The summary tool passed 21 focused tests and scoped lint after adding missing-timing support. The empty template was executed directly and returned zero observations. Tests use synthetic inputs to verify arithmetic and validation only. No real study, actual-phone test, migration deployment, provider accuracy evaluation or customer demo was completed by these preparation checks.
