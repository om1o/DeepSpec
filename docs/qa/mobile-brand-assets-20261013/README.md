# Mobile branding asset optimization — 2026-10-13

Scope: PR #119, initially based on `459b0db116bbfe7630c15b90f85addfa39b90b66`, then integrated onto concurrent head `fc316c2894782e02179c784618d0f9311665b2ce` without overwriting its chat changes. Final verification used a clean worktree containing the integrated source.
This report covers the scoped working tree committed with it, not the historical deployed branding evidence. No merge or manual deployment/promotion was performed. A push may trigger the repository's configured preview CI/deployment.

## Measured changes

| Use | Actual CSS width | PNG dimensions / bytes | WebP dimensions / bytes | Reduction |
| --- | --- | --- | --- | --- |
| BrandLockup and cloud-history placeholder | 36 / 44 / 56 px lockup | 1254×1254 / 578,313 | 168×168 / 9,552 | 98.35% |
| Scanner loading badge | 104 px (120 px animation container) | 1254×1254 / 604,256 | 336×336 / 37,328 | 93.82% |
| Combined source bytes | Loaded at separate points | 1,182,569 | 46,880 | 96.04% |

The exports support at least 3× device pixel ratio at the current maximum CSS dimensions. WebP was chosen to match existing application assets, avoid a second codec/fallback path, and preserve alpha with lossless encoding. High-resolution originals remain byte-identical in `public/brand` for design/export use. The animation, CSS dimensions, colors, shapes, shadows and timing are unchanged. PWA includeAssets now names the compact variants; originals are excluded from the optional Workbox precache glob. The current worker remains self-destroying; this is not an offline/PWA verification claim.

## Quality and loading evidence

`export.py` reproduces the exports using Pillow 12.3.0: Lanczos resize, lossless WebP, quality=90, method=6. The decoded exports exactly preserve alpha and every RGB pixel with nonzero alpha from the resized originals. WebP can discard RGB underneath fully transparent pixels, which does not alter visible artwork. `assets.json` records SHA-256 hashes and measured sizes. `comparison.png` shows both versions at their actual CSS sizes over dark/light backgrounds; visual inspection found no material change in shape, glass highlights or transparency. These are static image comparisons, not browser screenshots.

The production bundle references both WebPs and contains neither oversized PNG runtime URL, including the saved-history fallback. Both files are emitted in `dist/brand`. No lazy loading was added to delay either needed image. Smaller source bytes and decoded dimensions are measured; actual cold-load timing, request ordering, cache behavior and animation rendering remain unmeasured without a browser. No mobile latency improvement is claimed.

## Verification

- PASS: 29 focused tests across four files (BrandLockup, Auth, AnalyzingOverlay, asset-budget regressions), using Vitest's forks pool with the existing config.
- PASS: full ESLint, TypeScript (`tsc -b`), production Vite build, existing public-reference gate, new branding gate, `git diff --check`.
- New build gate checks byte budgets (12,000 / 45,000), 168/336 dimensions, lossless VP8L alpha, emitted assets and compact runtime references. Tests deliberately reject oversized, wrong-dimension and opaque replacements.
- FULL SUITE: 100 files pass / 1 file fails; 1,380 tests pass / 1 test fails. Using the existing config with the forks pool, the clean integrated tree fails only `server/vercel-layout.test.ts` because concurrent head `fc316c2` added `api/chat.test.ts`, which the endpoint-only layout guard counts as an unexpected entry. This file is not introduced by the asset change. Initial default-pool attempts hit a native runner error; a dirty-checkout run also encountered pre-existing untracked API helpers, all excluded from the upload. The clean integrated run supersedes those attempts. No all-tests-pass claim or release approval is made.
- BLOCKED: mobile viewport / browser network tests. Chromium is absent; browser download failed. QA doctor also records absent app target, public Supabase config and authorized account credentials. No product bug inferred from these environment failures.
- NOT VERIFIED: physical phones, Safari/Android, installed PWA, protected branded routes, real provider and durable account journey. Existing release gates still apply.

Logs: `focused-tests.log`, `lint.log`, `build.log`, `full-suite.log`, `qa-doctor.md`. Historical default-pool startup evidence: `full-suite-startup.log`. The doctor report is environment evidence only.

## Reproduction

Run from the repository root:

```sh
python docs/qa/mobile-brand-assets-20261013/export.py
node node_modules/vitest/vitest.mjs run scripts/verify-brand-assets.test.mjs src/components/BrandLockup.test.tsx src/screens/Auth.test.tsx src/screens/AnalyzingOverlay.test.tsx --configLoader native --pool forks --maxWorkers=1 --no-file-parallelism
npm run check
```

Review findings addressed by source/bundle evidence: `discussion_r4242622753` and `discussion_r4249939160`. Broader final-branding verification findings remain open.
