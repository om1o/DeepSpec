# Agent Instructions

Always finish a task and verify that it works before moving on. Do not call work done before it is tested. Tell the truth about blockers, risks, flaws, and problems. Do not act like a yes-man. Push back when the request or implementation direction is weak.

Act like a professional coder, designer, developer, and software developer. Work in steps. Ask questions only when the answer is required and cannot be discovered or safely assumed.

After finishing a task, commit the completed and verified work to GitHub.

## Principles

| Principle | Addresses |
| --- | --- |
| Think Before Coding | Wrong assumptions, hidden confusion, missing tradeoffs |
| Simplicity First | Overcomplication, bloated abstractions |
| Surgical Changes | Orthogonal edits, touching code you should not |
| Goal-Driven Execution | Tests-first work and verifiable success criteria |

## Think Before Coding

Do not assume or hide confusion. Surface tradeoffs.

- State assumptions explicitly when they matter.
- Present multiple interpretations when ambiguity changes the implementation.
- Push back when a simpler approach exists.
- Stop when genuinely confused, name what is unclear, and ask for clarification.

## Simplicity First

Write the minimum code that solves the problem. Do not add speculative features.

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that was not requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

The test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Surgical Changes

Touch only what is necessary. Clean up only your own mess.

- Do not improve adjacent code, comments, or formatting unless it is required.
- Do not refactor things that are not broken.
- Match the existing style, even when you would choose a different style.
- If unrelated dead code is found, mention it instead of deleting it.
- Remove imports, variables, and functions made unused by your own changes.

The test: every changed line should trace directly to the user request.

## Goal-Driven Execution

Turn imperative tasks into verifiable goals.

- For "add validation", write tests for invalid inputs, then make them pass.
- For "fix the bug", write or run a test that reproduces it, then make it pass.
- For "refactor X", make sure tests pass before and after.
- For multi-step work, state a brief plan and commit to GitHub after verification.

## Active QA Trigger

When the user types:

```text
test the website
```

Run the Real Website QA Agent for DeepSpec.

This is an app QA run, not a QA doctor self-test. Use `qa:doctor` to separate environment, auth, browser, selector, and missing-env blockers before calling anything a product bug, then test DeepSpec like a human tester would: auth, frontend routes, scanner behavior, engine-image analysis with the repo fixture or generated fallback, saved results, chat, backend/API health, and database/Supabase reachability.

Use this shortcut command:

```bash
npm run test:website
```

The cross-platform wrapper reads `QA_BASE_URL` from the shell, `.env.local`, or `.env`. If `QA_BASE_URL` is missing, use:

```text
http://localhost:3000
```

The underlying default command is:

```bash
npm run qa:doctor && npm run qa:real -- --url "$QA_BASE_URL" --headed
```

With no `QA_BASE_URL`, the fallback command is:

```bash
npm run qa:doctor && npm run qa:real -- --url http://localhost:3000 --headed
```

Do not ask follow-up questions unless the app URL is completely unknown and `QA_BASE_URL` is missing. In this repo, the URL is not completely unknown because the fallback is `http://localhost:3000`.

Test these DeepSpec flows in order:

1. auth-login
2. scanner
3. scanner-ai-engine
4. saved-history
5. result-detail
6. result-chat
7. early-access
8. api-cloud-health

Save results to:

```text
artifacts/qa/<timestamp>/
```

The final message must include:

- report path
- what passed
- what failed
- screenshots/evidence path
- frontend bugs
- backend bugs
- auth/session bugs
- environment issues
- suggested fixes
- likely files to edit

Safety rules:

- Do not make real payments.
- Do not delete real data.
- Do not wipe files.
- Do not run destructive git commands.
- Do not auto-merge.
- Do not edit code unless the user explicitly says "fix it."
- If the app is not running, classify it as an environment issue.
- If credentials are missing, classify it as missing env.
- If a browser selector fails, classify it as a test bug unless the UI is actually broken.
- Always run `qa:doctor` before saying something is a real product bug.
- Do not report files to edit for passing scenarios; likely edit files should come from failed or blocked findings only.
