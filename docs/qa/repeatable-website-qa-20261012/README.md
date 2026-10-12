# Repeatable website QA verification — October 12, 2026

Scope: PR #119, starting at `9cf1ed76730687fd37e597f6da8dc38ac64818db`, review [4243358249](https://github.com/om1o/DeepSpec/pull/119#discussion_r4243358249). This evidence covers the scoped QA-access changes committed with this report, not release approval or older deployment/branding claims.

## Change

- Replaced the unscoped development credit bypass with an exact-account, administrator-marked, freshly authenticated, expiring non-production exception. Production and ordinary users retain the existing credit gate.
- Kept actual entitlement reporting intact; added separate read-only QA-access evidence.
- Required browser-session preflight before every intentional live engine/web-AR/external-AR upload.
- Scoped QA doctor sign-out to its own session to preserve concurrent runs.
- Added regression coverage and the [operator runbook](../../REPEATABLE_WEBSITE_QA.md), including revocation and live acceptance checks. No database migration, counter reset, or paid entitlement grant was added.

## Local evidence

- Final [`npm run check`](full-check.txt): **99 files / 1,366 tests passed**, full ESLint, TypeScript, production build, and public-asset validation.

- [Affected tests](focused-tests.txt): 107 passed across 6 files, including existing Supabase administrative transport regressions.
- TypeScript, production build, and public-asset verification passed. Existing Transformers bundle-size warning remains.
- Deliberately restored the original bypass locally: three new regression tests failed (repeatable preview reservations, two eight-image handler runs, and unauthenticated development access). The probe was reverted before final verification.
- Independent code/security review found no blocking issue; its separate focused run passed 83 tests.
- Whitespace check passed.

## Live checks blocked

[QA doctor report](qa-doctor.md): missing Supabase URL/public key and dedicated QA credentials; no app serving the selected loopback URL; Playwright package available but Chromium executable absent. No screenshots were captured. These are environment blockers, not observed product bugs.

No live Supabase query, administrator metadata change, test-account setup, deployment configuration, provider request, counter readback, or physical-device testing was performed. Live credentials/deployment access are still needed to activate the mechanism and run web AR twice plus external AR while confirming unchanged counters. Existing key-rotation, provider-budget, cloud-save, and phone/PWA launch gates remain open. No merge or production promotion is authorized by these results.
