# DeepSpec private V1 tester brief

Date: October 1, 2026

Status: **engineering candidate for one supervised rehearsal. Not approved for a 5-15 person cohort, paid launch, or public launch.**

DeepSpec's V1 job is narrow:

> Photograph an unfamiliar vehicle part, review what the model saw, ask a focused follow-up, and keep the photo, answer, and correction in one record.

It does not prove exact fitment, hidden condition, function, repair safety, value, or an OEM part number from one photo.

## Tester policy

- Start with family and trusted reviewers in supervised sessions.
- There is no paid tester program and no promise of future free access.
- Keep beta access free while the product is being tested.
- Expand only after the core flow works on real phones and real parts.

## The assignment

1. Scan 10 real vehicle parts in ordinary lighting and work conditions.
2. Mark every result **Looks right**, **Looks wrong**, or **Not sure**.
3. Ask at least three focused follow-up questions. Judge whether the answer chose an appropriate depth between 9 and 25 sentences and stayed relevant to the scan.
4. Send at least three specific feedback notes. Include what worked, what failed, or what caused doubt.
5. Reopen at least three saved records. Confirm that the original photo, model answer, follow-up, rating, correction, and feedback still belong to the same scan.

Do not use dangerous live repairs, customer-identifying photos, license plates, private documents, or a result that must be trusted without human review.

## Five zones to judge

| Zone | What to test | Pass signal |
| --- | --- | --- |
| Capture | Camera permission, upload fallback, bad-photo guidance and retake | A usable photo can be submitted without a blocked control |
| Result | Part suggestion, visible evidence, alternatives and uncertainty | The screen is scannable and never presents a guess as proven identity |
| Follow-up | One question tied to the saved scan | The answer is useful, 9-25 sentences, and asks for better evidence when needed |
| Record | Save, reload, history, export and account switching | Data stays with the right scan and account; failures remain visible |
| Feedback | Right, wrong, not sure, correction and issue report | A tester can report a problem without losing the original answer |

## What the observer records

For every attempt, retain:

- coded part ID, device, browser and connection state;
- completed, abandoned or provider-failed outcome;
- right, wrong, not sure or independently unverified identity;
- human or reference evidence when calling a result right or wrong;
- capture attempts, elapsed time and visible provider delay;
- save, reload and reopen result;
- feedback reason and one plain-language usefulness note.

Keep wrong, unresolved, abandoned and rate-limited attempts in the denominator. A model's confidence is not ground truth.

## Stop conditions

Stop the session and preserve the evidence if:

- a saved record, correction, follow-up or photo disappears;
- another account can read or edit the tester's private scan;
- an unsupported identity is accepted for external use;
- the UI claims a device save is a cloud backup;
- camera, upload, review or feedback controls are blocked;
- the app presents fitment, function or safety as proven by the photo;
- repeated provider throttling prevents the assignment from continuing.

## Current engineering evidence

- Production browser QA passed all 21 automated scenarios on desktop, including auth, scanner, one engine-image result, cloud save, history, result follow-up, founding-tester page, shop workflow and billing fail-closed behavior. Evidence: `artifacts/qa/2026-10-02T02-25-42-553Z/report.md`.
- Phone emulation at 390 x 844 passed scanner, saved history, result detail and the public tester page. Evidence: `artifacts/qa/2026-10-02T02-40-45-520Z/report.md`. Emulation is not a physical-phone result.
- The result/feedback slice previously passed 159 focused tests. The latest provider and evaluator changes pass 117 focused tests.
- Lint and a production build pass. The build still reports the existing large Transformers.js chunk warning.
- A one-image provider health check passed with Groq `qwen/qwen3.8-27b` in 4.6 seconds total.
- The 50-case release evaluation is **not green**. Nineteen cases passed before the prior provider chain stopped on sustained HTTP 429 responses. After replacing Groq's retired Llama 4 Scout model, single calls work, but the current account tier still throttles a sustained run. This is capacity evidence, not an accuracy score.
- The broad local Vitest command stayed CPU-active without completing a file for about nine minutes and was stopped. Focused suites and browser QA passed; require final CI to complete before a cohort.

Groq retired the previous Llama 4 Scout model on July 17, 2026. The repository now defaults to its current Qwen 3.8 vision model. Source: [Groq model deprecations](https://console.groq.com/docs/deprecations) and [Groq vision models](https://console.groq.com/docs/vision).

## Go sequence

1. Build the exact candidate with `VITE_DEEPSPEC_DEBUG=off`. Internal isolation diagnostics must not cover tester controls.
2. Pass one physical iPhone Safari smoke test and one physical Android Chrome smoke test: permission allow/deny, upload, interruption, save, reload, reopen and sign-out/in.
3. Configure provider quota that can finish `npm run eval:identify:release`, then retain the complete 50-case summary. Do not turn an incomplete 19-case prefix into an accuracy claim.
4. Require green CI on the exact tester commit. Record the commit, deployment URL and run URL.
5. Verify deployed monitoring access, rate limiting, spend cap and rollback. Trigger one synthetic failure and confirm an operator can see it without exposing photos or personal data.
6. Run supervised family tests first. If they pass, invite a small trusted group in waves and review failures before expanding.

Public feedback abuse throttling, retention/deletion operations, email recovery, payment concurrency and shared-shop permissions remain separate public or paid launch gates.

## Decision

**Go now:** owner-run physical-phone and one-person supervised rehearsal after the exact build is deployed with diagnostics off.

**Do not go yet:** unsupervised 5-15 person cohort, paid access, ads promising accuracy or savings, or public launch.

Use the detailed [V1 launch plan](V1_LAUNCH_PLAN.md), [private-beta checklist](PRIVATE_BETA_RELEASE_CHECKLIST.md), and [seller pilot packet](PILOT_RUNBOOK.md) for operator steps and measurement fields.
