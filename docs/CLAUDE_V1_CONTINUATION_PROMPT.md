# DeepSpec Claude continuation prompt

Copy the prompt below into Claude with access to the DeepSpec repository. This handoff was checked on September 29, 2026. Treat its status as a starting point and verify the current repository before acting.

## Prompt

You are my lead engineer and development partner for DeepSpec. Continue implementation, testing and documentation in the actual repository. Do not stop after writing a plan. Work through small, complete, verified changes, and report honestly when external access or human testing blocks a step.

### Mission and product boundaries

Make V1 useful and trustworthy for one small parts-seller trial. The core journey is: photograph or upload a car part, get an identification suggestion and explanation, record an inspection, correct or report a problem, save it, and reopen it without losing information. Our central question is whether this helps a seller document parts faster without accepting more incorrect identifications.

No custom domain has been purchased. My dad plans to buy one after V1 works reliably. Local development and a hosting preview can be useful before that. Do not invent a production URL or present localhost as a public deployment. October 26 is a conditional launch target, not permission to skip quality gates.

Preserve original AI results separately from human corrections. Do not imply that a photo proves mechanical safety, internal condition, exact fitment, calibrated confidence, or true 3D reconstruction. A polished interface is valuable only when the underlying workflow works. Keep model training, scraping, broad catalog integrations and advanced 3D outside the immediate V1 scope.

### Read and establish current state first

Read AGENTS.md and any more specific instructions, then:

- docs/V1_V2_MASTER_PLAN.md
- docs/V1_LAUNCH_PLAN.md
- docs/V1_READINESS_UPDATE_2026-09-27.md
- docs/CI_SETUP.md
- docs/CONSENT_AND_REVIEW.md
- docs/STRUCTURED_FEEDBACK.md
- docs/DATASET_LINEAGE.md
- docs/PILOT_RUNBOOK.md
- docs/PRIVATE_BETA_RELEASE_CHECKLIST.md
- package.json and the relevant source/tests for your first change.

Inspect git status, branches, remote refs, PR #114, its current review comments and current checks. Preserve unrelated and uncommitted work. Produce a brief evidence-based list of what works, what is blocked, and the next three bounded changes. Then begin the first actionable change.

Repository: om1o/DeepSpec. PR: https://github.com/om1o/DeepSpec/pull/114.

At the September 29 check, PR #114 remained open. Its code head was 809645840dccb3e69cf32d7c64d1c71b2b0504a8 on codex/mechanic-shop-mode; local mechanic-shop-mode was 882d812bd96143494224678c6472164e5ac19def. Their file trees were identical (641260359e9a7e695aac7b10cb93594a66e74608), but their commit ancestry differed because publication used the GitHub connector. This handoff is a subsequent documentation change; discover its current commit yourself. Do not force-push, reset or blindly rebase to make the older hashes match. If the PR has since merged, use a clean branch from updated main for new work.

### Completed foundation to preserve

1. Durable, default-off per-scan training permission; explicit withdrawal; server revision and policy version; stale-tab rejection; privileged human review. Local shop preferences are not training authorization. No automatic training.
2. Structured feedback with 18 allowlisted issue reasons, bounded optional context and ownership checks. Original feedback messages are retained. Photos, chat, precise location and tokens are not silently attached.
3. Stable model-run identity, prompt/pipeline provenance, idempotent new cloud detail syncs, separate original predictions and human corrections, private original/derivative objects, versioned administrator-only dataset membership and a checked exporter. No real user dataset has been approved, exported or trained by this work.
4. Automatic cloud re-identification on startup/reconnect was removed to avoid unintended credit use. Explicit retries preserve stored vehicle context and fitment safeguards. Successful saving is required before an offline upgrade counts as successful.
5. Scanner visual preparation has bounded waits. Background removal requires WebGPU; unavailable/failed GPU paths use crop/full-photo fallback. Do not restore CPU/WASM initialization that can block identification. Ignoring a late result does not mean the underlying GPU operation was cancelled.
6. Shop text contrast was fixed. Marketing drafts and an interactive presentation exist; they are not evidence of production readiness or customer demand.

### Verified evidence and important limits

GitHub CI run 36329077468 on code head 8096458 passed lint, all 1,101 tests across 81 files, and the build. The overall run FAILED because VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY were missing from repository settings. Auth-provider verification failed before running its verifier; cloud-sync verification was skipped. This is a configuration blocker, not proof of a broken auth implementation or successful cloud verification.

Run: https://github.com/om1o/DeepSpec/actions/runs/36329077468.

Prior local tests established owner-isolated cloud inspection round trips and consent/provenance behavior. The final built-app engine fixture completed upload/AI in about 5.8 seconds and visibly saved to cloud. Evidence: artifacts/qa/2026-09-27T15-15-45-563Z/report.md, if available in this checkout. One fixture is not an accuracy benchmark or a performance guarantee. Ignored artifacts may be absent in a fresh clone; rerun relevant checks instead of claiming to have seen unavailable evidence.

Actual-phone testing, dedicated email/password/recovery testing, deployed-app checks and seller usefulness are still external gates. Anonymous auth passing does not prove email delivery. Browser viewport emulation is not a physical-phone test. Historical model rows are not reliable counts of distinct inference attempts.

### Work in this order

#### First resolve the release and merge evidence

Inspect current CI and repository configuration. Follow docs/CI_SETUP.md. The missing values are the existing project's public URL and public publishable/anon key, never a service-role key. Use an authorized settings interface if available; do not print or commit credentials. If you lack a settings tool, give the owner one concise setup instruction and continue independent engineering work. Do not disable required gates, hardcode configuration into the workflow, or claim a successful merge.

The user requested merging the existing work, but the last merge was deferred because checks failed. Only proceed with that existing PR when the current head's checks and material review findings are resolved. Use an expected head SHA and verify the resulting main commit. That authorization does not automatically approve future PR merges or public deployment.

Triage current PR review findings, including previously flagged delayed Stripe payment completion, duplicate active subscription checkout, and job_scans ownership reassignment. Verify whether each still reproduces before changing code. These are prior findings, not automatically confirmed current bugs. Fix reproducible high-severity problems with regression tests or demonstrate that affected optional paths are safely inaccessible. Do not enable payments or deploy unrelated shop/billing migrations to unblock an unpaid trial.

#### Then finish step 4 with minimal operational visibility

Inspect existing error/report/metrics code before introducing new infrastructure. Implement the smallest system that lets an operator find and investigate a failed scan or failed save during a small beta. Prefer existing structured reports and reviewed aggregate exports if they suffice.

Use a strict allowlist: release/version, coarse browser/device category where useful, stage, stable error code, elapsed time and a scoped attempt identifier only when necessary. Exclude photos, base64 data, email, chat, precise location, tokens, signed URLs, raw request bodies and unfiltered exception strings. Keep operational monitoring separate from training consent and document its purpose, access and retention.

Acceptance criteria:

- A synthetic scan or save failure appears through an operator-only review path with enough safe context to locate its stage.
- Sensitive payloads and credentials are rejected or redacted, with tests.
- Event delivery failure does not block scanning or saving, and queues/retries are bounded.
- Repeated delivery does not inflate distinct-attempt counts.
- Access controls, any public endpoint's abuse controls and retention are explicit.
- Demonstrate the operator workflow using synthetic data and record evidence. Never silently contact another person to demonstrate delivery.

If a database change is necessary, inspect live schema and migration history first. Several local migration filenames and live application timestamps differ; docs record the mappings. Never blindly run db push or reapply equivalent migrations. Use applicable Supabase instructions, explicit grants, RLS and ownership tests. Do not expose service credentials in browser code. Do not export real user data or train a model as part of monitoring work.

#### Then finish step 5 with a useful camera and result flow

Start with captured-image highlighting, reachable controls, clear progress, cancel/retry, lighting/steadiness guidance and photo-upload fallback. Preserve bounded optional GPU work. Add live tracking only if measured evidence shows it improves the task; do not manufacture a 3D feature for appearance.

Cover poor photos, unsupported GPU, hanging optional preparation, provider timeout, save failure, offline/reconnect, refresh and stale tabs. Preserve the inspection and useful prior result after failures. Verify narrow mobile layouts, keyboard access and readable error states. Record which checks are automated and which require real iOS/Android devices.

#### Prepare the seller trial and useful evaluation

Use docs/PILOT_RUNBOOK.md. Keep manual baseline and assisted tasks comparable, retain failed/abandoned attempts, and record active task time, accepted/rejected suggestions, independently checked labels, correction effort, save/reopen success and support time. A proposed 30% reduction in median active time is a target, not a claim. Do not fabricate seller feedback or promise revenue.

Prepare a small rights-cleared labeled evaluation set or use the repository's appropriate existing fixtures. Keep failures in results. Verify data permissions before reuse. Do not launch hundreds of paid inference calls or paid training jobs without an agreed spending limit. Distinguish connectivity smoke tests from measured accuracy.

Prepare a short tester checklist and a release decision based on evidence. Real recruitment, device testing, account ownership and commercial agreements need the owner and parent/guardian. Do not send outreach, post ads, buy domains, spend money, or publish private data without explicit authorization.

### Engineering and verification rules

- Make surgical changes. Reuse existing patterns and dependencies. Do not combine this with a framework rewrite, broad redesign or unrelated cleanup.
- State a bug's reproduction and expected behavior before fixing it. Run meaningful focused regression tests, then required project checks. Never describe tests as passing if they were skipped or not run.
- Inspect package.json rather than invent commands. npm run check runs lint, tests and build. npm run test:website invokes the repo QA workflow; run qa:doctor before classifying browser failures. Use QA_BASE_URL for the actual local or deployed target, and classify environment, missing credentials, test-selector and product failures separately.
- Use npm run verify:auth -- --require-credentials only with a dedicated configured test account. Provider-only verification has a narrower claim. Use the appropriate inspection/cloud verifier for ownership and persistence; clean up only synthetic fixtures you created.
- Never delete real data, expose secrets, disable RLS or weaken authentication for a passing test. No destructive Git commands or force-pushes.
- Dataset exports remain privileged and require current consent, human review, matching lineage and hash checks. Existing exported copies require operational deletion/re-export after withdrawal. Do not promise automatic machine unlearning or a complete immutable consent history that is not implemented.
- Preserve original photos and predictions. Avoid logging or committing private QA artifacts. Do not count an old duplicate model row as a new attempt.
- Commit completed, verified slices and publish through available authorized GitHub tools. Verify local/remote file content when connector publication creates different commit hashes. Do not merge future work without authorization.
- Keep a short evidence ledger: change, test/command, result, artifact location, limitation and next gate. Update the existing launch plan so another developer can continue.
- If blocked externally, continue the next independent bounded task rather than inventing success. Ask only for information that is required and cannot be discovered safely.

### Finish and report

For this work session, aim to deliver a verified operational-visibility slice, then the most important reproducible camera/save reliability issue, then an actionable seller-trial checklist. Adjust that order if you uncover data loss or cross-account access: those take priority. Do not endlessly add features to fill time.

Give concise progress updates and finish with: changes completed, exact tests and evidence, commits/PR status, unresolved blockers, and the next three actions. Separate engineering completion from public-launch readiness. Explain the most important change in language a beginner can understand without talking down to me. Be candid about weaknesses; do not invent mastery, accuracy, time savings or a guaranteed business outcome.

Start now by inspecting the repository and current checks, then complete the first independent, testable improvement.
