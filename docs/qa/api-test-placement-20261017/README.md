# API test placement — PR #119

Date: 2026-10-17 (America/New_York)

Finding: [P1: Move the chat test out of api/](https://github.com/om1o/DeepSpec/pull/119#discussion_r4264265132).

## Change and provenance

Initially inspected PR head: `f3884c1864500358f3f59361a726e4f57a0374f5`, branch `codex/v1-preview-20261010`. Initial validation below covers that source plus this test relocation. Concurrent commits were then preserved as described below. This follow-up changes no application source, dependency, build configuration, or endpoint implementation.

- Moved `api/chat.test.ts` to `server/chatHandler.test.ts`, matching the existing `server/identifyHandler.test.ts` convention.
- Updated the handler import and both shared-module imports/mocks for the new directory. A direct comparison confirms the rest of the test file is unchanged.
- Preserved all 10 handler regression cases: disabled flags with unavailable infrastructure; POST-only behavior; enabled-chat rate-limit and authorization failures; provider access only after the enabled-chat gates succeed. Network responses are mocked.
- Kept `server/vercel-layout.test.ts` unchanged, including its exact six-file assertion, ESM import check, SPA rewrite check, and all six handler method guards.

## Results

Clean isolated checkout; `npm ci --no-audit --no-fund`; Node 24.19.0 / npm 11.9.0. No application `.env` files were copied into this checkout.

| Check | Result | Evidence |
| --- | --- | --- |
| Original source layout | Expected failure: the same recursive directory comparison used by the layout guard finds the seventh file, `chat.test.ts` | [baseline-api-layout.log](baseline-api-layout.log) |
| Chat handler, shared chat, Chat screen, and Vercel layout tests | PASS — 4 files / 36 tests | [focused-tests.log](focused-tests.log) |
| Full test suite, default threads pool | PASS — 101 files / 1,381 tests | [full-tests.log](full-tests.log) |
| Full ESLint | PASS | [lint.log](lint.log) |
| TypeScript `tsc -b`, Vite production build, public/brand asset checks | PASS | [build.log](build.log) |
| Source inventory and preservation | PASS — exactly six API files; all six byte-identical to the inspected head; test body unchanged apart from import/mock paths | [source-verification.json](source-verification.json) |
| `git diff --check` | PASS | Local diff check |

The build retains the existing warning for the 550.87 kB Transformers JavaScript chunk. This follow-up does not address that performance issue.

Reproduction commands (the three full commands are the stages of `npm run check`, run separately here):

```sh
npm ci --no-audit --no-fund
npm test -- server/chatHandler.test.ts server/chat.shared.test.ts server/vercel-layout.test.ts src/screens/Chat.test.tsx
npm run lint
npm test
npm run build
git diff --check
```

The recorded focused invocation also included `src/services/chat.test.ts`, which does not exist; Vitest selected the four existing files listed above. No service-test pass is claimed.

## Concurrent branch updates

The branch advanced during publication. The expected-head check prevented replacing concurrent work:

- `f54ad59879ecc5a798324a7fd052de5288f753bc` changed disposable QA credential generation and its regressions. Rebased this fix on that commit and reran the complete `npm run check`: **PASS — full lint, 101 files / 1,390 tests, TypeScript, production build and asset checks**. See [integrated-check.log](integrated-check.log).
- `4ceb7898cd45bee23b1afdd7ade57f70cc28dd63` subsequently moved the scanner timer outside its live region and updated overlay regressions. Rebased again without conflicts; the six API handlers and this test relocation are unaffected.

Verification on `4ceb7898` plus this relocation: **`npm run check` PASS — full lint, 101 files / 1,394 tests, TypeScript, production build and both asset checks**. See [final-check.log](final-check.log).

- `7666da7d1c799080152759a9da9de8c2d6d056db` then repaired completed-answer persistence retries and updated Chat/storage regressions. Preserved this change and rebased the test relocation without conflicts. This is the final parent commit for publication.

Final verification on `7666da7d` plus this relocation: **`npm run check` PASS — full lint, 101 files / 1,409 tests, TypeScript, production build and both asset checks**. See [published-source-check.log](published-source-check.log). This supersedes the earlier local run counts for the published source. The source inventory confirms all six HTTP handlers remain byte-identical to this final parent. Evidence-only edits after validation do not change the tested application or test source.

## Function exclusion and release boundary

`api/` now contains only `account-entitlement.ts`, `billing-checkout.ts`, `billing-portal.ts`, `billing-webhook.ts`, `chat.ts`, and `identify.ts`. There is no test under that directory, and no runtime source in `api/` or `server/` imports the relocated test. The exact-inventory regression verifies that helpers or tests cannot silently re-enter the deployable API source directory.

[Vercel's Node.js runtime documentation](https://vercel.com/docs/functions/runtimes/node-js) states that supported source files in the root `api/` directory become separate functions. The relocated test is outside that discovery directory. This is source-layout verification, not inspection of a deployed function bundle. `npm run build` builds the Vite application and checks TypeScript/assets; it is not `vercel build`.

No live provider, authenticated-account, physical-device, or deployment-bundle test was performed. CI and Vercel statuses for the pushed commit must be reported separately from these local results. The existing launch gates and unrelated review findings remain in force. Do not merge or promote the October 26 conditional release solely because these checks pass.
