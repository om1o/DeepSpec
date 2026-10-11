# Branding QA evidence — 2026-10-11

Application candidate: `96e34ce9ee79d1cf0137d57b218576e833d0ecc6`.

This directory is evidence for the scoped reconciliation in the root `DEEPSPEC_QA_REPORT.md`. It is **not release approval**. The commit adding it changes only documentation/evidence. Local checks used Node 24.19.0 and the existing dependency installation; GitHub CI installed dependencies afresh on Node 22.

## Reproduce local checks

```sh
npm test -- src/components/BrandLockup.test.tsx src/screens/Auth.test.tsx src/screens/Chat.test.tsx src/screens/EarlyAccess.test.tsx src/screens/History.test.tsx src/screens/Result.test.tsx src/screens/Shop.test.tsx scripts/verify-public-assets.test.mjs
npx eslint src/components/BrandLockup.tsx src/components/BrandLockup.test.tsx src/screens/Auth.tsx src/screens/Auth.test.tsx src/screens/Chat.tsx src/screens/EarlyAccess.tsx src/screens/History.tsx src/screens/Result.tsx src/screens/Shop.tsx vite.config.ts
npm run build
QA_BASE_URL=https://deepspec-git-codex-v1-preview-20261010-deep-spec-team.vercel.app npm run qa:doctor
```

Vitest ran seven existing test files (125 tests); the Shop test filter did not match a file. The build includes `tsc -b` and `verify:public`. The doctor was blocked and is retained as failure evidence, not counted as a pass.

## Files and scope

| Evidence | What it establishes |
| --- | --- |
| `component-tests.log` | Exact-head focused test result |
| `scoped-lint.log`, `build.log` | Scoped lint and TypeScript/build/public-target results |
| `public-assets.json` | Read-only live asset GETs, PNG dimensions, byte sizes and SHA-256 hashes; each matches the candidate's `dist` bytes |
| `desktop-auth.jpg`, `desktop-observation.json` | Signed-out desktop rendering and root/history redirects to auth; no authenticated-screen coverage |
| `qa-doctor.md`, `qa-doctor.json` | Missing local config/account and missing Chromium executable; no mobile browser checks completed |
| `browser-install-summary.txt` | Failed attempt to install the missing browser |
| `ci-provenance.txt` | Selected non-secret CI observations with job/run and merge-ref provenance |

The cloud-browser desktop evidence was collected on the mutable branch alias. Vercel's deployment inspector required sign-in. Asset equality does not prove the entire deployment revision. No secret values or authentication state are stored here.

Still required: mobile viewports (390×844 and 320 CSS pixels), authenticated branded screens/navigation, immutable-deployment identity, physical phones and installed PWA behavior. The logo's 578,313-byte transfer remains the separate mobile-performance review finding. Authentication, credential rotation, provider success, durability and cost controls remain independent release requirements.
