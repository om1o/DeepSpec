# Parts-intake pilot: measurement packet

Status: ready-to-fill protocol and empty template. No customer study, measured time savings, accuracy result or paid commitment has been collected by this task.

## First seller: ready-to-run checklist

Use one seller, one operator and one part family (for example alternators) for the first trial. A second device may verify readback, but do not edit the same inspection concurrently: cloud writes still lack conflict resolution.

Before scheduling measured work:

- Owner/developer: deploy `supabase/migrations/20260920000100_part_inspection.sql` through the normal database process; run `npm run verify:supabase -- --inspection` and retain its successful readback/isolation evidence. Missing schema blocks a cloud-backed trial.
- Owner/developer: configure the existing Supabase Actions secrets and pass the integration PR checks. Record the tested commit, not just the app URL.
- Observer/operator: rehearse on the actual phone with a fictional record. Save an inspection, reload and compare every field; sign out/in and repeat; verify it on a second signed-in device; export the report. Confirm another account cannot see it. Keep evidence outside Git.
- Observer/operator: disconnect the network, edit the fictional inspection and save. Confirm device-only/failed-cloud wording, reload to verify local retention, reconnect and save again. Confirm cloud readback before calling it backed up. Do not clear browser storage during recovery.
- Observer/operator: open the same inspection in two tabs, save in one, then attempt to save the older form. It must retain the draft and request review rather than silently overwrite the newer local inspection. This is a stale-form check, not proof of atomic cross-device conflict protection.
- Seller: approve photo storage and required intake fields; agree on the timing protocol and continuation target below. No training permission is implied.

Schedule one short onboarding/rehearsal session, ten manual baseline observations, then one twenty-part comparison batch (ten manual, ten assisted). Review that batch before scheduling another. Keep onboarding/support time separate and report it alongside savings. Measure all normal inspection/testing steps in both arms.

Recruitment draft for the owner to send personally (not sent by this task):

> Could we observe how you document incoming alternators, then try a small supervised DeepSpec comparison? You would check every identification and keep your normal tests. We would measure staff time, corrections and whether saved records reopen correctly. This is a prototype trial, not a promise that it can determine whether a part works. We would agree on photo storage first; training or public sharing would require separate permission.

Stop the trial for any lost inspection, cross-account exposure, or unsupported identity used externally. Retain the failed observation and investigate before restarting. If the cloud gate or provider availability is blocked, use only a clearly labeled local rehearsal; do not count it as a successful cloud-backed seller trial.

## Freeze the scope before timing

Record the date, app commit, provider/model configuration, operator pseudonym, chosen part family, existing documentation workflow and required functional checks. Choose one family with a participating business. Record its permission to process/store photos; permission to train or publicly share is a separate decision. Keep customer identifiers, license plates, private reference material and credentials out of committed study files. Store working logs in the ignored `artifacts/pilot/` folder and use coded part/operator IDs.

Use the week plan's initial ten ordinary manual intake observations to check the protocol and establish a baseline. Keep this baseline in its own batch. For each later twenty-part batch, assign ten comparable items to manual intake and ten to DeepSpec, balancing easy/hard cases and alternating workflows to reduce operator-order effects. Use distinct physical parts across arms and batches. This is a small feasibility study; do not claim causal or population-level accuracy estimates. The separate Maker Portfolio isolation experiment uses paired images and has a different protocol.

Before a held-out batch, freeze the expected component names, acceptable synonyms and human/reference-based identity judgment. Do not use DeepSpec's own answer as ground truth. Mark unknown ground truth **unverified**. Retain every attempted part, including abandoned workflows, provider failures, unreadable labels and rejected photos. One physical part is one observation; its original scan and retake are multiple captures of that observation, not independent samples. Keep development examples out of the held-out batches.

## Per-part observation sheet

Copy this block for each physical part; enter observed values, never estimates disguised as measurements.

- Observation ID / physical part ID / batch:
- Workflow: manual or deepspec:
- Operator pseudonym / order / easy-hard stratum:
- Start and finish timestamps:
- Active time in seconds (all hands-on work, including functional checks):
- Functional-test active seconds (already included above, not added again):
- Elapsed seconds (includes waiting; at least active seconds):
- Capture attempts, including rejected photos and retakes:
- Outcome: completed or abandoned; reason if abandoned:
- Identity: correct, wrong, unresolved or unverified:
- Was this identity accepted for external use? true or false:
- Human/reference check supporting a correct/wrong judgment:
- Original scan ID(s), retake ID(s), export/evidence path:
- Capture / lookup / typing / correction / test bottleneck notes:
- Actual provider requests and known service cost; write unknown when unavailable:
- Support/onboarding minutes and interruption notes:

Use a stopwatch or recorded observation. Pause active timing during passive provider waiting; keep elapsed timing running. Never remove necessary inspection or test work to make the assisted workflow look faster. If timing is interrupted beyond reliable reconstruction, retain the case in the raw log as missing measurement and repeat a separately identified development rehearsal. Do not silently replace missing duration with zero or drop the failed part from the narrative denominator.

## Machine-readable copy and summary

Copy [the empty template](pilot-observations.template.json) to `artifacts/pilot/observations.json`. Add one JSON object per attempted physical part, including attempts with missing timing. Required fields are:

| Field | Accepted value |
| --- | --- |
| `id`, `physicalPartId`, `batch` | Nonempty strings. IDs unique; physical parts unique across this study. |
| `workflow` | `manual` or `deepspec` |
| `outcome` | `completed` or `abandoned` |
| `identity` | `correct`, `wrong`, `unresolved`, `unverified` |
| `accepted` | JSON boolean describing the operator's actual decision, not model confidence |
| `reference` | Human/reference check; required for correct/wrong, empty for unknown |
| `activeSeconds`, `functionalTestSeconds`, `elapsedSeconds` | Nonnegative numbers; functional time ≤ active time ≤ elapsed time |
| `timingMissingReason` | If timing is unreliable, set all three timing fields to `null` and record a nonempty reason. Retain any partial timing in raw notes; never substitute zero. |
| `captureAttempts` | Nonnegative integer; include original and retake captures |

Additional notes can remain in the raw log. The tool does not infer missing values, authenticate reviewer claims or adjudicate reference correctness.

```powershell
node scripts/pilot/summarize-intake-pilot.mjs artifacts/pilot/observations.json
```

The command reads only that file and prints a JSON summary; it makes no network requests. Empty data reports `no_observations`. Each batch stays separate. Every attempt remains in outcome counts, including untimed attempts. `timedObservations` and `missingTiming` show the timing denominator. Time medians and totals cover only fully timed attempts (including abandoned cases); totals are `null` when none are timed. Any missing timing in either arm suppresses that batch's percentage reduction. Early abandonment may look artificially fast, so always inspect completion/error counts alongside the descriptive reduction. Functional-test time remains in active time. Invalid measurements and repeated physical parts are rejected instead of quietly excluded. Synthetic values in unit tests validate arithmetic only; they are not pilot evidence.

## Review after each batch

Report attempted/completed/abandoned counts, correct/wrong/unresolved/unverified identities, accepted-wrong and accepted-unverified cases, capture attempts, median active/elapsed time, support effort and observed service cost. Include the summarizer's timed and missing-timing counts, and reconcile attempted counts with the raw log. Show difficult and failed examples, not just successes.

The proposed continuation target from the week plan is at least 30% lower median active time without more wrong accepted identities than manual intake. That target is not an automatic pass: reject conclusions driven by abandoning hard cases, different functional checks, missing measurements or imbalanced difficulty. A single unreviewed unsupported identity used externally stops expansion and becomes a regression case. Compare the two batches separately and explain changes between them.

Discuss paid continuation with the owner only after showing the actual results. Record a clear yes/no/not-yet, quoted scope/price, reasons and required integration work. The existing $99/$249 figures are hypotheses, not validated prices. Do not send automated outreach, collect a payment or change checkout as part of this packet.

## Demonstration and rollout limits

Before a real trial, verify camera/upload on the actual device and save/reload/export. For a local-only rehearsal, label it clearly and retain exports. Cloud human-inspection records still require the existing database migration and live verification. Dedicated-account isolation checks remain a release gate. Current guided retakes are capped per active scanner sequence and keep separate scan records; the observer must group attempts by physical part. No 3D measurement, hidden-defect detection or trained custom model is claimed.
