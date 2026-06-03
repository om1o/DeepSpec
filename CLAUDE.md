# Claude Instructions

Follow `AGENTS.md` for this repository. The active QA trigger below is repeated here so coding agents that read Claude-specific instructions behave the same way.

## Active QA Trigger

When the user types:

```text
test the website
```

Run the Real Website QA Agent for DeepSpec:

```bash
npm run test:website
```

The wrapper reads `QA_BASE_URL` from the shell, `.env.local`, or `.env`. If `QA_BASE_URL` is missing, it falls back to `http://localhost:3000`.

Test these DeepSpec flows in order:

1. auth-login
2. scanner
3. saved-history
4. result-detail
5. result-chat
6. early-access
7. api-cloud-health

Save results to `artifacts/qa/<timestamp>/`. The final response must include the report path, what passed, what failed, screenshots/evidence path, frontend bugs, backend bugs, auth/session bugs, environment issues, suggested fixes, and likely files to edit.

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
