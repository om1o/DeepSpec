# Private identification diagnostics

This first operational-visibility slice lets an operator review identification-service failures through private server logs. It does not collect photos, prompts, model predictions, user IDs, headers, URLs, email, chat or exception messages. It creates no database table, public telemetry endpoint, background queue or automatic training path.

## Enable and review

Set the **server-only** `DEEPSPEC_DIAGNOSTICS=1` to enable it; the default is off. Restart the server after changing its environment. Never use a `VITE_` variable for this switch. When supplied, `VERCEL_GIT_COMMIT_SHA` must be a 40-character hexadecimal commit SHA; otherwise the release is recorded as `unknown`. Other hosts can set that server variable to their tested release SHA.

Each completed `createIdentifyResponse` invocation emits one `[DeepSpec diagnostics]` JSON line containing schema version, a generated event UUID, server timestamp, release, fixed `identify` stage, allowlisted code, HTTP-style service status, and elapsed service milliseconds capped at one hour. Provider fallbacks do not create additional events. Unexpected exceptions retain their original behavior and produce only `unexpected_error`, never their messages. Logging failures are swallowed without rerunning inference or replacing its response.

Only authorized operators with access to the host's private server logs should review these lines. There is no browser dashboard or client-readable log endpoint. The code does not establish hosting permissions: verify log access in the chosen host before a real beta. Local server output is visible to people/processes with access to that terminal.

Export a small time window from the private logs to the ignored `artifacts/qa/` directory. Keep the raw export private; other existing log lines may contain information outside this new allowlist. Run:

```powershell
node scripts/summarize-diagnostics.mjs artifacts/qa/operator-log.txt
```

The command makes no network calls. It accepts at most 10 MiB, validates exactly the known schema, discards malformed or extra-field events, never echoes raw lines, deduplicates identical event IDs and rejects conflicting duplicates. It prints counts by code/release, median service time and at most 20 recent failure records. `rejected` counts candidate diagnostic lines that failed validation; unrelated log lines are ignored. Review nonzero rejected counts before using the totals.

Use `not_configured` to investigate server provider configuration, `network` for provider connectivity, `rate_limited` for provider throttling, and `invalid_response` for unusable provider output. `invalid_input` or `image_too_large` points to the uploaded request format/size. `provider_error`, `other_error` and `unexpected_error` need a safe reproduction; never add raw payload logging just to investigate them.

## Limits and retention

This measures **identification-service outcomes**, not all HTTP requests, users, photo attempts or saved inspections. It runs after the HTTP method/auth/rate/credit gates and before later credit consumption. Those gates, later billing failures, camera failures, client save failures, process termination and lost host logs are not captured. An `ok` event proves only that the identification service returned successfully; it does not prove payment handling, correctness, cloud saving or user-visible completion. Logged durations exclude earlier preparation and later saving. Duplicate HTTP retries receive separate event IDs; only repeated delivery of the same emitted event is deduplicated.

There is no delivery retry, external alert or guaranteed durable log sink. The implementation is synchronous bounded event construction and a single console write; it does not add an awaited network dependency. The existing host controls log buffering and retention. During the beta, review logs after each supervised session and before the next trial. Choose the shortest practical host retention, with a seven-day target, and remove local raw exports after review within that window. This is an operator policy, not automatic deletion implemented here; verify the host's actual retention before enabling real-user diagnostics. Keep only necessary sanitized aggregate findings in project notes.

Operational diagnostics are separate from photo storage and training permission. Enabling them does not approve any image for training. The rest of the app's existing logs have not been reclassified as safe by this change.

## Verification

`server/identifyDiagnostics.shared.test.ts` covers an actual synthetic unconfigured-provider invocation, explicit opt-in, unknown-code/release redaction, exception preservation and a failed log sink. `scripts/summarize-diagnostics.test.mjs` covers safe operator output, repeated/conflicting IDs, invalid fields, input bounds and incident-list bounds. No provider call or real photo is needed for these checks.

Before public deployment, additionally prove host access restrictions, deployed log delivery and retention, then cover remaining save/auth/HTTP failure stages. Local synthetic evidence is not deployed monitoring readiness.
