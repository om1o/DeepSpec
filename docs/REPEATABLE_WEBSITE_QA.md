# Repeatable website QA without customer-credit resets

The web-AR suite (`npm run qa:web-ar`) has eight image cases and up to three attempts per case by default. External AR adds four image cases; real-website QA includes a live engine upload. These are different from the eight core route/workflow checks. Five lifetime free attempts cannot fund repeated runs: failed provider attempts also remain consumed.

## Supported test path

Use a dedicated confirmed password account on a controlled **non-production** app and preferably a separate Supabase test project. The server's existing development switch is now scoped to that account, administrator-owned metadata, and an expiring authorization. It does not create a paid subscription, reset data, alter free/paid counters, or grant checkout, portal, chat, shop, or other paid access.

A trusted operator must configure all of the following. This code change does not configure or deploy them automatically.

1. Create/select a dedicated QA account in the target Supabase project, confirm its email or phone, and retain its UUID. Do not use a customer account. Account creation/confirmation is an administrative setup task, not something the browser runners do.
2. Using Supabase's trusted administrator API, set `app_metadata.deepspec_scan_qa` to the boolean `true`, preserving any existing metadata. `user_metadata` is user-editable and never authorizes testing. Do not place administrator keys in the browser or any `VITE_` variable.
3. Configure these **server-only** environment variables on the test deployment:

   | Variable | Value |
   | --- | --- |
   | `DEEPSPEC_ENFORCE_SCAN_CREDITS` | `false` |
   | `DEEPSPEC_QA_SCAN_USER_ID` | Exact dedicated QA account UUID |
   | `DEEPSPEC_QA_SCAN_EXPIRES_AT` | UTC ISO timestamp in the future, at most 24 hours away; e.g. output of `node -e "console.log(new Date(Date.now()+3600000).toISOString())"` |
   | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Target project's server configuration; legacy service-role key remains supported |

4. Use explicit `NODE_ENV=development` or `test` locally. Hosted Vercel Preview uses the platform-provided `VERCEL_ENV=preview` even though its `NODE_ENV` is `production`. Never override platform environment labels to activate testing. `VERCEL_ENV=production` always denies the exception; generic `NODE_ENV=production` without Vercel Preview also denies it. Missing/unknown environment labels fail closed. A timestamp further away stays inactive until its final 24-hour window; use a short expiry for the current run and remove it afterward.
5. Configure the runner's `QA_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `DEEPSPEC_AUTH_TEST_EMAIL`, and `DEEPSPEC_AUTH_TEST_PASSWORD` for that app/account. Keep passwords and tokens out of committed files and reports. Restart/redeploy the test server after changing server configuration; variables on the runner alone do not authorize a remote app.

Every identification request re-fetches the authenticated user from Supabase before evaluating the exception. No request header, body field, client flag, user metadata, or locally decoded JWT can turn it on. Other accounts always use normal credit accounting, including on the same preview with the switch set to `false`. No administrative reset RPC or new database migration is introduced.

## Run and record evidence

Run `npm run qa:doctor` first, then the applicable runner:

```bash
npm run test:website -- --headless
npm run qa:web-ar
npm run qa:external-ar
```

Use `npm run build` followed by `npm run qa:serve-production` to test the built app locally; that command serves a production build on loopback and does not make the environment a production deployment. Explicitly configure its runtime as above. External AR additionally requires its existing local image fixtures; web AR downloads the attributed Commons fixtures.

Before each live engine/AR image submission, the runner reads `/api/account-entitlement` with its actual browser session. It requires current `qaScanAccess` evidence matching that session. The field is separate from the real entitlement: an exhausted free QA account still reports five free attempts used and is never presented as paid. No credits are reserved by this read. Missing configuration, expired access, a mismatched account, a failed preflight, or an older server stops the image submission with setup guidance. The real-website runner classifies this as a blocked `missing_env` scenario. AR reports include the setup error; it is not a model-quality observation.

These automated live-image runners require scoped test access and deliberately do not spend customer or paid credits as a fallback. Production credit/billing acceptance tests should use the normal gate with specifically budgeted attempts, not this mechanism. UI-only and synthetic/mocked website scenarios can still run without this exception.

Run web AR twice with the same account, then external AR. Compare administrator-read `free_scan_usage`, `billing_entitlements.scans_used`, and `scan_credit_reservations` before/after; they must be unchanged for these authorized QA requests, including provider failures. Use only test data and record the tested commit, deployment, expiry, attempt outcomes, and provider costs. Do not include credentials or private photographs in committed reports.

Rate limits, provider configuration, input validation, session checks, and billing protections remain in place. Web AR can issue up to 24 provider requests with default retries; account-credit bypass does **not** mean free provider usage or unlimited throughput. Keep existing delays, use a reviewed provider budget/spend cap, and classify provider/rate-limit failures separately. This mechanism alone does not authorize spending.

The doctor signs out only its own session (`scope: "local"`), preserving concurrent QA/browser refresh sessions.

## Revoke and verify normal protections

Set `DEEPSPEC_ENFORCE_SCAN_CREDITS=true`, remove the QA UUID/expiry from the deployment, or remove the administrator metadata flag. Expiry also revokes the exception. The next request uses the normal gate; no counter is refunded. Remove test deployment configuration when testing ends and never copy it into production.

Separately verify on a test project with normal enforcement:

- A confirmed ordinary account is limited to five lifetime attempts, including provider failures; the sixth attempt is rejected before inference.
- Anonymous/unconfirmed identities and invalid sessions cannot claim QA access.
- Setting user metadata or arbitrary QA headers cannot bypass limits.
- Paid holds, successful consumption, failed-hold release, exhaustion, and webhook accounting behave normally.
- A production deployment ignores every QA setting, even for the marked account.

## Verification boundary

Local unit/handler tests use synthetic users and mocked Supabase/provider responses. They cover two eight-image runs, failures, production denial, expired/malformed/overlong configuration, absent auth, metadata spoofing, normal paid/free accounting, preflight wiring, and rate-limit preservation. They do not establish live Supabase transport, deployed metadata/configuration, actual provider success, durable cloud saves, concurrency against a real database, or physical camera/PWA behavior.

Live acceptance requires authorized Supabase credentials, deployment access, provider budget/configuration, browser/fixture availability, and the repeated-run observations above. Physical-device checks remain a separate launch requirement. Existing SQL coverage is `supabase/tests/free_scan_usage.sql`; this change does not modify its schema or RPCs.

Supabase references: [administrator user metadata](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid), [local sign-out scope](https://supabase.com/docs/reference/javascript/auth-signout).
