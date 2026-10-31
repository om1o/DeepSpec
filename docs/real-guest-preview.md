# Historical guest preview (superseded)

The October 29 authenticated repair supersedes the instructions below. The normal journey is now intro → `/auth` → authenticated app. The client guest flag, API auth/credit bypass and guest limiter selection are removed; setting the old environment flags no longer enables account-free access. Guest storage remains untouched and is never silently imported into an account. The unused guest quota helper/Edge source remains for provenance; this repair does not deploy or change it.

The following describes PR #124 before the repair, not current setup instructions. See [the hosting audit](REPAIR_HOSTING_AUDIT_2026-10-29.md) for current deployment requirements.

## Prior behavior

The preview opens on the packaged DeepSpec intro. Every entry button opens `/scan`, the existing camera/upload scanner. `/demo` and `/auth` also lead to that scanner in this preview; the former sample application is removed.

This is the real app: uploaded images call `/api/identify`, follow-up questions call `/api/chat`, and the existing result, saved scan, inspection, export and shop screens use isolated browser storage. No example results are injected. A browser namespace is never treated as a Supabase user or authorization token. Guest mode neither reads account cloud records nor changes an existing sign-in session.

Enable the preview with `DEEPSPEC_GUEST_PREVIEW=true` and `VERCEL_ENV=preview`. Both must match at build time for the client and at runtime for the live API. The source-controlled Vercel flag has no effect on production access. Supplied Authorization headers continue through normal account/session and credit checks. Missing-auth preview requests retain the existing distributed IP limits and request validation before the real provider runs. Chat is enabled only for guest-preview requests; normal configuration is preserved.

For local UI development, run:

```sh
DEEPSPEC_GUEST_PREVIEW=true VERCEL_ENV=preview npm run dev
```

Live analysis still uses the existing server provider configuration. Missing provider/network/quota errors are shown honestly by the normal app. No keys belong in client code. Account billing, cloud sync and training consent are outside the browser workspace.

`npm run build` packages the intro from the tracked marketing source and verifies its resources. `scripts/package-intro.mjs` keeps the intro, white vector identity and blue-glass entry synchronized with the real app.

Guest preview limits are verified through the narrow `deepspec-guest-quota` Supabase Edge function using the project’s injected server credentials. The Vercel API sends only a SHA-256 hash of the trusted client IP and a fixed identify/chat scope. The function can only increment the existing rate-limit counters with fixed limits; it returns allow/deny and never returns a key or account data. Quota failures remain closed. Normal account traffic keeps the original limiter.
