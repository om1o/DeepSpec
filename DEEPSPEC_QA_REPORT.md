# DeepSpec V1 Preview QA Report

## Current evidence reconciliation — 2026-10-22 (America/New_York)

**Decision: release acceptance remains unverified; this documentation update is not launch approval.** October 26 is conditional. The implementation candidate inspected is [`a908ba32b78aeaed7e998ef4b3ed193340e0313c`](https://github.com/om1o/DeepSpec/commit/a908ba32b78aeaed7e998ef4b3ed193340e0313c), PR [#119](https://github.com/om1o/DeepSpec/pull/119), branch `codex/v1-preview-20261010`, targeting `codex/mechanic-shop-mode` at `a28e1a19147a50751248f2546fae4224f332aa9c`. The PR was open and unmerged at inspection. This supersedes the current-candidate designation below; the October 11 observations remain historical, with their original dates, revisions and limitations preserved.

This reconciliation changes documentation only. Its eventual commit is an evidence revision, not a new runtime candidate. Do not attribute the following results to later application changes without another verification pass. The coordination board was inspected: its ownership entries are historical/unknown and are not an atomic lock. No active overlapping report update was visible in the inspected PR discussion or branch state.

### Revision-linked automated and deployment evidence

| Evidence | Result | Scope and limitations |
| --- | --- | --- |
| [CI run 39075527035, attempt 1](https://github.com/om1o/DeepSpec/actions/runs/39075527035), [Quality gate job 117521770402](https://github.com/om1o/DeepSpec/actions/runs/39075527035/job/117521770402) | **PASS**, completed October 17; freshly inspected October 22 | Run metadata associates it with head `a908ba32`. Job logs explicitly check out PR merge ref `1226c070204551940f2c2207f4686f65e16b2f54`, merging that head into `a28e1a19`. Ubuntu 24.04, Node 22.23.3, npm 10.9.9. This is integration evidence, not an exact-head local run. |
| Same CI job: `npm run check` | **101 files / 1,409 tests PASS**, ESLint, TypeScript, Vite build and both public/brand asset gates PASS | Synthetic/intercepted test inputs do not demonstrate live provider success, deployed authorization, RLS or real-user acceptance. |
| Same CI job: live Auth verifier | Settings verified: signup enabled, anonymous sign-ins disabled | Password sign-in **SKIPPED** (credentials absent); email code request/entry **SKIPPED**; OAuth browser sign-in not tested. A successful workflow step does not mean every subcheck ran. These are October 17 settings observations, not a fresh dashboard audit. |
| Same CI job: cloud-sync verifier | **NOT RUN**: two confirmed QA identities absent | This branch permits that step to exit successfully when configuration/credentials are missing; [workflow source](https://github.com/om1o/DeepSpec/blob/a908ba32b78aeaed7e998ef4b3ed193340e0313c/.github/workflows/ci.yml). No live cloud durability or cross-account isolation pass. |
| Previously recorded exact-source local verification | **101 files / 1,409 tests**, lint, TypeScript, build and asset gates PASS | October 17 [published-source report and logs](https://github.com/om1o/DeepSpec/blob/a908ba32b78aeaed7e998ef4b3ed193340e0313c/docs/qa/api-test-placement-20261017/README.md). This is existing evidence, not a test newly executed October 22. |
| Commit status and deployment bot, freshly read October 22 | Vercel **success** for `a908ba32`; bot reports **Ready**, updated October 17 at 22:33:34 UTC | [Deployment 5ZjbdQ9QuRaWKKxc2766AC1Ckzcr](https://vercel.com/deep-spec-team/deepspec/5ZjbdQ9QuRaWKKxc2766AC1Ckzcr), [bot evidence](https://github.com/om1o/DeepSpec/pull/119#issuecomment-6098033621), [commit status API](https://api.github.com/repos/om1o/DeepSpec/commits/a908ba32b78aeaed7e998ef4b3ed193340e0313c/status). The bot links the [mutable branch preview](https://deepspec-git-codex-v1-preview-20261010-deep-spec-team.vercel.app). No new deployed browser/API test, immutable served-source verification, function-bundle inventory or authenticated journey was performed. |

The old `360d140e` deployment's `503 rate_limit_unavailable` result and missing server-key inventory below were **not rechecked** and must not be presented as current deployment behavior. Likewise, October 11 asset hashes and screenshots do not verify today's compact assets or protected routes. Green Vercel status is deployment-service evidence only.

CI retains the 550.87 kB Transformers chunk warning and 23,567.05 kB ONNX WASM output. Its dependency installation also reported **23 audit findings (1 low, 10 moderate, 12 high)**. This is a historical install summary, not a newly triaged vulnerability assessment or proof of exploitability; no dependency fixes were applied in this documentation task.

### Newly executed local checks — October 22

Clean isolated checkout at exact head `a908ba32`; Node 24.19.0 / npm 11.9.0. Existing dependencies were reused from another local checkout whose `package-lock.json` was byte-identical; this was **not a fresh `npm ci` or dependency audit**. No application `.env` or QA credentials were copied. Application/test source remained unchanged; only documentation/evidence was edited. Logs contain synthetic test activity, not live provider transactions.

| Command | New result | Evidence |
| --- | --- | --- |
| `npm run check` | **PASS, exit 0** — ESLint; **101 files / 1,409 tests** (105.67 seconds); TypeScript, production build and both asset gates | [full-check.log](docs/qa/reconciliation-20261022/full-check.log) |
| Focused Vitest, forks pool: `server/chatHandler.test.ts`, `server/vercel-layout.test.ts`, `src/screens/AnalyzingOverlay.test.tsx`, `scripts/qa/confirmed-session.test.mjs`, `src/screens/Chat.test.tsx`, `src/services/storage.test.ts` | **PASS, exit 0 — 6 files / 122 tests** | [focused-tests.log](docs/qa/reconciliation-20261022/focused-tests.log) |
| Full Vitest with `--configLoader native --pool forks --maxWorkers=1 --no-file-parallelism` | **PASS, exit 0 — 101 files / 1,409 tests** (110.99 seconds) | Additional local runner cross-check; default-run evidence retained above |
| Separate `npm run build`; `git diff --check` | **PASS** | Build reproduced TypeScript/bundling/asset success and retained the existing model-chunk warning |

The default runner initially emitted no progress beyond startup, prompting the forks cross-check, but then completed successfully. No stalled-run or product-failure conclusion is warranted. Neither local runner tests live Auth, real providers, deployed storage, physical phones or spending enforcement. A documentation-only successor commit carries these logs; the tested implementation revision remains `a908ba32`.

### Completed implementation findings and acceptance boundaries

Current source was inspected against the following review follow-ups; passing combined CI above supersedes their earlier pending-CI/endpoint-layout failure statements for this candidate only. Original reports/logs remain unchanged.

| Finding and source | Implemented change / existing verification | Still unverified |
| --- | --- | --- |
| Disposable QA passwords: [`f54ad59879ecc5a798324a7fd052de5288f753bc`](https://github.com/om1o/DeepSpec/commit/f54ad59879ecc5a798324a7fd052de5288f753bc), [review follow-up](https://github.com/om1o/DeepSpec/pull/119#discussion_r4304766112) | `Aa1!` plus 32 cryptographically random bytes encoded as hex; 68 ASCII bytes. Recorded 184 focused tests / 15 files; rejection, cleanup and credential-redaction regressions. | Actual hosted password policy, live account creation and billing replay acceptance. Mocked client success is not a live billing result. |
| Scanner announcements: [`4ceb7898cd45bee23b1afdd7ade57f70cc28dd63`](https://github.com/om1o/DeepSpec/commit/4ceb7898cd45bee23b1afdd7ade57f70cc28dd63), [follow-up and evidence](https://github.com/om1o/DeepSpec/pull/119#discussion_r4304772955) | Elapsed timer sits outside the polite status region; meaningful step/download updates remain inside. Recorded 63 relevant tests / 3 files, including DOM-mutation checks. | Actual VoiceOver/TalkBack or desktop screen-reader speech/queue behavior. The follow-up explicitly keeps manual acceptance open; implementation is not full accessibility acceptance. |
| Completed-answer save retry: [`7666da7d1c799080152759a9da9de8c2d6d056db`](https://github.com/om1o/DeepSpec/commit/7666da7d1c799080152759a9da9de8c2d6d056db), [follow-up and evidence](https://github.com/om1o/DeepSpec/pull/119#discussion_r4304785478) | Pending exchanges retain IDs and answer; save retry calls persistence only. ID merges repair partial writes; route/account guards discard stale completions. Recorded 137 focused tests / 8 files. | Live authenticated durability/isolation. A failed primary write retains the answer only on the current page; leaving/reloading can lose it. Production chat remains disabled by default. |
| Vercel API test placement: [`a908ba32`](https://github.com/om1o/DeepSpec/commit/a908ba32b78aeaed7e998ef4b3ed193340e0313c), [follow-up](https://github.com/om1o/DeepSpec/pull/119#discussion_r4304796607) | `api/chat.test.ts` moved to `server/chatHandler.test.ts`; all 10 handler cases retained. Current source has exactly six production API endpoints. Combined CI is green. | Deployed function-bundle inspection. Vite build is not `vercel build`; source discovery checks do not inspect deployed packaging. |

Additional intervening evidence: [repeatable bounded QA](https://github.com/om1o/DeepSpec/blob/a908ba32b78aeaed7e998ef4b3ed193340e0313c/docs/qa/repeatable-website-qa-20261012/README.md) replaces the general development bypass with an exact-account, expiring non-production QA exception; [disabled-chat gates](https://github.com/om1o/DeepSpec/blob/a908ba32b78aeaed7e998ef4b3ed193340e0313c/docs/qa/disabled-chat-20261013/README.md) avoid saved unanswered questions and reject disabled requests before infrastructure/provider access. [Compact branding assets](https://github.com/om1o/DeepSpec/blob/a908ba32b78aeaed7e998ef4b3ed193340e0313c/docs/qa/mobile-brand-assets-20261013/README.md) are already implemented and covered by the current gates; the original oversized-asset findings below are historical. Compression was not repeated. Actual mobile performance remains unmeasured.

### Remaining release requirements

| Requirement | Current evidence state | Completion evidence required on the intended candidate/environment |
| --- | --- | --- |
| Live-provider identification | **UNVERIFIED** | One ordinary scan with original input, outcome, latency, provider/model/run ID and independently assessed result; preserve failures/retries. Use an explicitly approved no-cost path or obtain specific spending authorization before chargeable requests. Automated provider mocks are insufficient. |
| Authorized-account persistence | **UNVERIFIED**; CI login/cloud checks skipped | Confirmed account: sign in, restore session, scan, save, history readback, refresh/reopen, logout/login and reopen again; verify image, result, correction and notes, including interruption/offline recovery. A save toast or device-only row is not cloud readback. |
| Account isolation | **UNVERIFIED live**; synthetic scoping regressions pass | Two distinct authorized confirmed identities; deny other-account record/image reads and writes; shared-device switching must not expose or overwrite the prior account. Record cleanup and exact project/deployment. |
| Physical phones / PWA / accessibility | **UNVERIFIED** | Actual iOS Safari and Android Chrome camera permission/denial, first flip, upload fallback, capture, analysis, save/reopen and navigation; screen-reader announcements; home-screen icon/cropping/standalone launch if claimed. Browser viewport emulation alone is insufficient. |
| Spending controls | **UNVERIFIED deployed** | Verify final-project migrations and server credential, trusted-proxy rate limit, concurrent five-free-attempt enforcement and sixth-attempt rejection, provider budget/cap configuration, failure cleanup and disabled-chat enforcement. Do not run paid traffic or enable production chat to gather this evidence. The bounded QA exception is not customer cost-control acceptance. |
| Server credential rotation and Auth hardening | Historical unresolved gate; **not freshly audited** | Platform owner privately verifies new server-only key across consumers, then legacy deactivation; confirm password/leaked-password policy where supported. October 17 CI confirms anonymous sign-ins disabled only. No secret creation, installation, rotation or settings change was performed here. |
| Candidate/deployment and operational acceptance | **PARTIAL**: associated CI/status succeeds | Map immutable served deployment to approved source; inspect API behavior and private failure visibility, retention and save-error reporting. Recheck consent/withdrawal/ownership; keep training disabled pending the independent permission/review/deletion/lineage gates. |

Fresh read-only [private-beta tracker](https://docs.google.com/spreadsheets/d/1ItKIs_P1btB3JZ8VL9DlAG-YFUMRsEYm3Qr9JXmmrPg/edit), October 22: Overview `A1:H45` records access **NOT RECORDED**, no approved environment/release commit, zero attempts and zero save/reopen checks. `Attempts!A1:AE15` and `Save checks!A1:AE15` contain instructions/headers only; `Phone flow!A1:AE15` is an instruction checklist, not completed observations. `Release gates!A1:AE15` still uses its October 10 snapshot and retains unverified provider, persistence, isolation and cost-control requirements. This establishes missing evidence in those records, not absence of testing elsewhere. Tracker contents were not edited and no tester observations were invented.

The next useful acceptance step is for the release/platform owner to identify an approved immutable preview and privately configure two confirmed QA identities plus a verified no-spend provider path. Run bounded QA and real-device checks there, attach evidence, then make a separate release decision. Updating this report does not grant that decision or bypass remaining gates. No merge, manual deployment/promotion, public launch, provider call, account creation, auth email, payment or security-setting change was performed in this reconciliation. Repository integrations may automatically rebuild a branch preview following its documentation commit; that is not manual promotion.

## Historical report — October 11 (preserved original evidence)

Everything below is retained as originally recorded. Terms such as “current”, “now”, unresolved findings and next actions in that historical text refer to its own date/revision. They do not override the October 22 reconciliation above.

Date: 2026-10-11 (America/New_York)

Candidate verified by this reconciliation: `96e34ce9ee79d1cf0137d57b218576e833d0ecc6` on `codex/v1-preview-20261010`. This supersedes the earlier `360d140e` candidate reference. Local branding tests/build and GitHub checks are revision-linked below. The public preview serves matching branding assets, but mobile and authenticated deployed visual checks remain **NOT VERIFIED**. A green build/status is not release approval.

Historical deployment `dpl_AbAgT2wpQUpRFNEh5XskkufXfSHB` at `360d140e` loaded its API functions but returned `503 rate_limit_unavailable` because Preview lacked a server-only Supabase key. That configuration/API result was **not rechecked** in this branding pass and must not be attributed to the latest deployment.

Pull request: https://github.com/om1o/DeepSpec/pull/119

PR #119 is the selected V1 integration path. PR #120 was closed without merge or deployment after its `vercel.json` blob was verified byte-identical to the copy already in PR #119.

## Executive Verdict

DeepSpec is not yet approved for V1 preview promotion. The release code and Vercel packaging are substantially healthier, but four pre-existing launch gates remain, alongside the incomplete branding, mobile and physical-device/PWA checks documented below:

1. Replace the exposed legacy Supabase `service_role` credential with a new server-only secret key, verify every consumer, then deactivate the legacy key.
2. Configure dedicated confirmed QA credentials, including the second isolation account, and rerun the live verifiers. Enable leaked-password protection where the Supabase plan supports it.
3. Prove one AI provider completes an ordinary scan on the candidate environment without violating the no-spending rule.
4. Pass the real verified-account journey: sign in, restore session, scan, save, history, refresh/reopen, logout/login, and reopen again.

No merge, production deployment, or manual promotion was performed. Vercel automatically built the branch preview linked below.

## Final Branding Evidence Reconciliation — 2026-10-11

Review finding: [`PRRT_kwDOSd6dgM6rQBIF`](https://github.com/om1o/DeepSpec/pull/119#discussion_r4242598542). **Partially addressed; keep open** until the missing deployed checks below have evidence.

### Revision and deployment provenance

- The requested `ef02d0dc6344551748113c8871b3168718eaacee` head had advanced to `96e34ce9ee79d1cf0137d57b218576e833d0ecc6` before this pass. A fresh remote-ref check confirmed `96e34ce9` remained the branch head before editing this report.
- Inspected both branding commits: `5cbffec` introduced `BrandLockup`, used it on Auth, Chat, EarlyAccess, History, Result and Shop, and updated PWA assets/configuration; `ef02d0d` replaced the symbol and icons with the final blue/cyan artwork. `BrandLockup` uses 36/44/56 CSS-pixel marks with the accessible name `DeepSpec` and an empty decorative-image alt.
- `git diff --name-only ef02d0d..96e34ce9` contains only this report and four test files. Application source, dependencies, build configuration and public assets are unchanged between those revisions. Local checks below ran on clean tracked source at **exact head `96e34ce9`**, Node **24.19.0**, using the existing dependency installation (direct package versions were checked against the lockfile).
- [CI run 38161501645](https://github.com/om1o/DeepSpec/actions/runs/38161501645) is successful for the earlier `ef02d0d` head. [CI run 38162100792](https://github.com/om1o/DeepSpec/actions/runs/38162100792) is successful for `96e34ce9`. Its job log explicitly checks out GitHub's PR merge ref `cabbcae131f2b5bb97a487e545e04b35d32dd094` (merging `96e34ce9` into `a28e1a19`), on Node 22. This is **integration evidence associated with the head**, distinct from the exact-head local run.
- GitHub reports Vercel status **success** for `96e34ce9`, linked to [deployment AxbwMRKzafrdCFcXzwYUvWwnB1qd](https://vercel.com/deep-spec-team/deepspec/AxbwMRKzafrdCFcXzwYUvWwnB1qd). The Vercel bot links it to the [branch preview](https://deepspec-git-codex-v1-preview-20261010-deep-spec-team.vercel.app). The deployment inspector required sign-in, so its immutable URL/source identity was not independently inspected. The mutable alias and matching asset hashes alone do not attest every deployed source file.
- The separately generated rotor/circuit logo concept is preview-only and is not integrated into this candidate or covered by its test results. This follow-up changes documentation and saved evidence only. Its commit is an evidence revision, not a newly tested application revision. Any subsequent runtime/asset changes require another targeted run and deployment mapping.

### Check results and boundaries

| Check | Revision / environment | Result and coverage |
| --- | --- | --- |
| Focused component and public-asset tests | Local exact `96e34ce9` | **PASS: 7 files / 125 tests** — BrandLockup, Auth, Chat, EarlyAccess, History, Result and public-asset verifier. Shop has no dedicated screen test; its import compiles in the build, but that is not a Shop render/navigation test. |
| Scoped ESLint | Local exact `96e34ce9` | **PASS** for BrandLockup/tests, six modified screens, Auth test and Vite config. |
| `npm run build` | Local exact `96e34ce9` | **PASS** — TypeScript, Vite production build and `verify:public`. Existing 550.87 kB Transformers chunk / 23.6 MB WASM performance warning remains. |
| GitHub quality gate | PR merge ref for `96e34ce9` | **PASS: 97 files / 1,317 tests**, lint, TypeScript, build and public-asset integrity. |
| CI live-auth/cloud evidence | Same CI job | Auth provider settings verified, including anonymous sign-ins disabled. **Password sign-in, code sign-in and cloud-sync verifier skipped**; logs state credentials were not supplied. A successful step is not a completed live account journey. |
| Public deployed branding and PWA resources | Branch preview, read-only GET on 2026-10-11 | **PASS** — symbol PNG, 192/512 PNG icons and generated manifest return HTTP 200 with appropriate content types and byte-for-byte equality to the local candidate build. PNG dimensions match their declared sizes. SHA-256/size ledger: [public-assets.json](docs/qa/branding-96e34ce9/public-assets.json). Both icons were visually inspected as blue/cyan symbols on dark backgrounds. |
| Desktop sign-in visual check | Live preview, 1363×936 CSS pixels | **PASS, signed-out scope only** — new symbol/name visible and unclipped, mark loaded at 56×56, hero image loaded, no horizontal overflow. Account tab, email/password fields and scanner sign-in control visible. [Screenshot](docs/qa/branding-96e34ce9/desktop-auth.jpg). |
| Desktop signed-out navigation | Live preview | Root and direct `/history` navigation end at `/auth` as expected. This checks the sign-in gate only; authenticated navigation and the other five branded screens remain uninspected. |
| Browser console | Cloud-browser desktop session | No application-origin error in captured logs. Two browser-extension metadata errors were present; this is not a complete network-error audit. |
| `qa:doctor` / mobile 390×844 | Local runner targeting live preview | **BLOCKED**, not a product failure. Preview HTTP 200 and Playwright import pass, but Chromium executable is missing; `npx playwright install chromium` exits 1 after an invalid/truncated downloaded archive. Local public config and dedicated QA account credentials are also absent. No mobile screenshot or mobile-layout pass is claimed. |
| Physical phones / installed PWA | Not run | **NOT VERIFIED** — home-screen icon, maskable cropping, standalone launch, Safari/Android rendering, camera and navigation still require actual device evidence. Asset dimensions and manifest validity do not prove installation behavior. |

Reproduction commands and saved logs are in [the evidence directory](docs/qa/branding-96e34ce9/README.md). The existing public-asset gate verifies document/manifest targets exist; it does not prove React image rendering, responsive layout, or runtime navigation. The additional deployed hash and desktop observations above cover only their stated scopes.

### Remaining evidence and findings

1. Restore a supported mobile browser runner and inspect at least 390×844 plus a narrow 320 CSS-pixel viewport. Check the lockup/status layout, clipping, overflow and reachable navigation. Preserve screenshots and viewport dimensions.
2. Use an authorized confirmed QA session to inspect Auth, History, Result, Chat, EarlyAccess and Shop at desktop/mobile sizes, including result/history/scanner back-links. No authenticated session was available in this pass; do not bypass the sign-in gate or substitute a fake session as deployment evidence.
3. Confirm the exact immutable Vercel deployment/source SHA and rerun the missing checks against it. The linked GitHub status plus asset equality is useful but bounded evidence.
4. The separate [mobile asset-size finding](https://github.com/om1o/DeepSpec/pull/119#discussion_r4242622753) remains open: the deployed symbol is **578,313 bytes / 1254×1254**, rendered at 36–56 CSS pixels. This pass records the confirmed cost; it does not claim mobile performance is accepted or modify the artwork.
5. Preserve the independent credential-rotation, password/auth hardening, real-provider, verified-account durability, cost-control and physical-device gates. No production setting, credential, customer record, provider call, payment, merge or deployment promotion was performed by this pass.

## Opaque-key and secondary-account review revalidation — 2026-10-11

The requested findings were already fixed when this task resumed: `7c343262` repaired production admin transport and the documented secondary-account variables; `0dac56e9` also repaired the webhook replay admin transport. Both original review threads were resolved. This follow-up preserves those implementations and adds 19 permanent regressions, based on `ef02d0dc` (including the concurrent branding change).

- The installed `@supabase/supabase-js` remains 2.105.4. Real SDK requests from both server and trusted-script factories are intercepted locally to verify opaque secrets travel in `apikey` without the generated bearer fallback. Legacy JWT keys retain their bearer header. Explicit user JWTs, including rejected tokens, are preserved rather than silently promoted to admin access.
- Coverage now includes administrative RPCs, entitlement writes, Auth user creation/deletion, Storage downloads, request bodies/methods, and custom headers. Production entitlement, scan-credit reservation/finalization, and rate-limit functions are exercised through the real SDK rather than mocking `createClient`. Two caller identities keep distinct user filters and credit parameters; rejected identity/key responses remain fail-closed.
- QA regressions verify the documented `DEEPSPEC_AUTH_TEST_OTHER_*` credentials, missing/blank secondary passwords, and exact significant password bytes reaching the login form. Device-storage regressions reject another account's scan update, result update, chat append, and deletion while retaining both accounts' records.
- Controlled local fault probes confirmed the regressions fail if either factory retains the opaque bearer fallback (2 failures) or the credential reader trims the returned password (3 failures). The fault probes were reverted before final verification.
- Independent code review found no blocking issue in the fixes or new regressions. Source inspection confirms server-only RPC grants still exclude `public`, `anon`, and `authenticated`; no authorization code, SQL policy, grant, dependency, or production setting was changed in this follow-up.

Validation (Node 24.19.0):

| Check | Result |
| --- | --- |
| Affected tests | PASS — 13 files / 268 tests |
| Full `npm run check` | PASS — full ESLint, 97 files / 1,317 tests, TypeScript (`tsc -b`), production build, public-asset gate |
| QA runner and webhook verifier syntax | PASS |
| `git diff --check` | PASS |

The build retains its existing >500 kB chunk warning (550.87 kB Transformers chunk and 23.6 MB ONNX WASM asset).

**Evidence boundary:** these are local automated tests with synthetic credentials and intercepted network requests. They prove SDK header construction and application request scoping, not live Supabase acceptance or deployed RLS. Password form-fill and local storage checks are not a completed live shared-device journey. No credential rotation, live account provisioning, payment, provider call, merge, or release promotion was performed by this pass. No deployment was requested or verified; the GitHub integration may automatically rebuild the branch preview after the evidence commit is pushed. Live rotation and the complete authorized-account journey remain separate release gates; unrelated review threads remain outside this task.

References: [Supabase API key guidance](https://supabase.com/docs/guides/api/api-keys) and the installed SDK's `src/lib/fetch.ts` at 2.105.4. The existing narrow transport fix is retained without copying upstream code or upgrading dependencies.

## Historical Candidate Verification — 2026-10-11 (`360d140e`; not a recheck)

Earlier candidate: `360d140e` on `codex/v1-preview-20261010`, deployed to Vercel Preview. All deployment/configuration observations in this section are historical; the revision-scoped branding reconciliation above supersedes its current-candidate designation.

- `0dac56e9` routes the billing webhook replay verifier through the shared opaque-key-safe Supabase admin client. Its 41 focused tests, syntax checks, ESLint, production build, and public-asset verification passed.
- `f8b4c990` stops `verify:auth` after an actionable missing-public-config error instead of continuing into an undefined `.replace` crash. The regression failed before the fix and all 12 verifier tests pass after it.
- `aef05dc3` fixes Node ESM resolution for all six Vercel API functions, uses compiler-stable discriminant checks, removes the incompatible `Array.at()` call, and excludes generated `.vercel` output from source linting.
- Historical Vercel logs for `f9532ab0` reproduced `ERR_MODULE_NOT_FOUND` for `/var/task/server/identify.shared`; `aef05dc3` fixed that packaging defect.
- Local verification for `aef05dc3`: 155 focused server/API tests passed; the full suite passed 95 files / 1,297 tests; ESLint passed; production build and public-asset verification passed; `vercel build --target preview` completed with zero TypeScript diagnostics; direct import of the emitted function returned `401 missing_session` without a Supabase or provider request.
- Post-push verification for `360d140e`: both GitHub Quality jobs again passed 95 files / 1,297 tests, lint, TypeScript, build, and public-asset verification. They failed only at the intentional live Auth preflight because anonymous sign-ins remain enabled.
- Vercel deployment `dpl_AbAgT2wpQUpRFNEh5XskkufXfSHB` is Ready. A live no-auth POST to `/api/identify` returns `503 rate_limit_unavailable`, proving the function loads but cannot initialize its server-side rate-limit/auth path. Read-only Preview environment inventory shows the public Supabase URL and publishable key only; no `SUPABASE_SECRET_KEY` or legacy service-role variable is present. This is a configuration blocker, not evidence of an RPC or schema defect.
- With explicit user confirmation, production project `tvmomaxmiecguqikpckb` was changed only to disable anonymous sign-ins. The dashboard retained new-user signup and email authentication. A fresh public Auth settings request independently verified `anonymous_users=false`, `disable_signup=false`, and email enabled. No password, key, or session value was displayed.

- `b33a2f40` preserves exact QA password bytes while still rejecting blank-only values, and preserves pending rating/correction through repeated local-storage quota failures. The two matching PR #119 review threads are resolved.
- Full local suite on the runtime fix: 94 files and 1,291 tests passed. Node syntax checks, full ESLint, TypeScript, and the production build passed.
- `fb331d6f` integrates the public-asset integrity gate from the now-closed duplicate PR #121. Its focused test, full ESLint, and the combined production build passed; the post-build asset check found no missing internal target.
- `7c343262` prevents opaque `sb_secret_...` admin keys from being copied into the bearer header while preserving explicit user JWTs, and makes shared-device QA consume the documented `DEEPSPEC_AUTH_TEST_OTHER_*` account variables without trimming password bytes. Both new PR review threads are resolved.
- Verification for `7c343262`: 78 focused tests passed; TypeScript and QA script syntax checks passed; full ESLint passed; production build and public-asset verification passed. The Windows full suite passed 92 files / 1,228 tests but reported five Scanner timeouts plus two worker-start failures after resource exhaustion. Fresh isolated reruns of Scanner, Auth, and History passed 3 files / 111 tests, including every timed-out case.
- Vercel preview: https://deepspec-git-codex-v1-preview-20261010-deep-spec-team.vercel.app
- Vercel Preview now has the public Supabase URL and publishable-key variables. The authorized rebuild for `9abd9be7` succeeded. Preview QA doctor `artifacts/qa/2026-10-11T15-12-04-588Z/qa-doctor.md` returned HTTP 200, found the current auth selectors, and captured no console or network errors.
- Direct phone-viewport evidence `artifacts/qa/2026-10-11T15-12-04-588Z/screenshots/auth-visible.png` confirms the Account form is visible and the earlier “Sign-in unavailable” state is absent. The doctor still reports missing local env because this isolated checkout intentionally has no copied Supabase values or authorized account password.
- Authenticated browser QA remains blocked honestly: no authorized password or reusable signed-in browser session is available to this lane. No password was searched for, displayed, reset, or sent by email.
- Both earlier Linux Quality gate runs on `d5457fcb` passed lint, all 94 test files / 1,291 tests, and build, then intentionally failed the live auth preflight because Supabase still reported anonymous sign-ins enabled. This is a production configuration blocker, not a code-test failure.

## Anonymous-auth Review Follow-up — 2026-10-11

Verified code candidate: `bc43282f` on `codex/v1-preview-20261010`, based on inspected PR head `0bc7f4d7`. The evidence-only commit containing this section does not change runtime code.

Both open review findings were reproduced in source before changes:
- `PRRT_kwDOSd6dgM6rJmMZ`: app cloud health and auth/cloud CLI verifiers depended on anonymous sign-ins.
- `PRRT_kwDOSd6dgM6rJmMa`: checkout and webhook replay used identities rejected by protected billing/account APIs.

Changes:
- App cloud health server-verifies the active confirmed user and pins its probe/cleanup client to that user's token. Account switches cannot write the old report into a new account. Normal cloud sync rejects anonymous and unconfirmed sessions. Old anonymous-health cache entries are discarded.
- App privacy probes check signed-out access, accepting explicit PostgreSQL permission denial but rejecting leaks and inconclusive network failures. These probes do **not** establish cross-account isolation; the CLI uses two distinct confirmed QA accounts for that check.
- Checkout uses configured confirmed QA credentials. Webhook replay creates a unique disposable confirmed identity using the trusted admin client, then uses its normal public-client session for entitlement and portal APIs. Synthetic grants never target a pre-existing customer account.
- CLI probes preserve password bytes, reject missing/unconfirmed/anonymous identities and same-account isolation tests before fixture writes, revoke only their own sessions, and keep fixture cleanup scoped. Billing success artifacts are emitted only after required cleanup succeeds.
- CI and setup instructions document both confirmed QA accounts; auth preflight requires anonymous sign-ins disabled. No server authorization, RLS policy, paid-credit rule, or scan allowance was weakened.

Earlier anonymous-auth verification in this checkout (Node 24.19.0):

| Check | Result |
| --- | --- |
| `npm run check` | PASS, exit 0; includes full lint, tests, TypeScript and production build |
| Full automated suite | 94 files, 1,291 tests passed; 88.89 seconds |
| Focused app cloud-sync regressions | 90 tests passed |
| Focused CLI/session regressions | 58 tests across 7 files passed |
| `git diff --check` | PASS |
| Final independent cleanup review | No material remaining issue found in checkout/replay paths |

An intermediate full run caught one stale CI-text test assertion (1,276 passed, one failed); it was corrected before the final green gate above. The build retains the existing >500 kB chunk warning (550.87 kB Transformers chunk and 23.6 MB WASM asset).

**Not verified here:** deployed login, live cloud round-trip/RLS, provider completion, billing sandbox endpoints, physical phones, key rotation, or deployment/promotion. No live account was provisioned, auth email sent, payment made, customer data deleted, or credential displayed. The only production configuration change in this pass disabled anonymous sign-ins with user confirmation. Configure the dedicated accounts described in `docs/CI_SETUP.md` and run the live verifiers before promotion. Previous deployment/advisor/browser results below remain historical evidence only.

## Earlier Candidate Evidence (`bdd941b9`; not a live recheck)

- Full automated suite: 91 test files and 1,256 tests passed on `bdd941b9`.
- Repository lint: `npm run lint` passed.
- Production build: `npm run build` passed.
- Vercel packaging: SPA fallback preserves `/api/*` and supports direct client routes; current Vercel commit status is successful.
- GitHub review: earlier findings were resolved. Two subsequent anonymous-auth review threads were open at `0bc7f4d7`; this follow-up addresses their code paths.
- Auth UI: anonymous/no-email customer entry was removed; the QA harness now requires configured password credentials and will not create an account or send an email.
- Billing access: anonymous or unconfirmed identities fail closed before checkout, entitlement lookup, and scan allowance.
- No-spend chat: production chat is disabled unless explicitly enabled; after a disabled response the composer cannot accumulate unanswered messages.
- Retry durability: recovered cloud images are bounded; a successful identification remains visible after a local storage failure; retry persists the complete result, frame, provenance, and pending feedback.
- Cross-platform retry recovery: downloaded images are converted from bytes instead of passing a foreign-realm Blob to FileReader; focused Windows tests and both Linux GitHub Quality gates pass.
- Inference truthfulness: unsupported measurements fail closed and changed prompt/pipeline behavior has explicit version lineage.
- Shop authorization: user-controlled membership role escalation is blocked in release code.
- Branding: the blue-slate DeepSpec logo renders on the current local auth screen at the phone viewport.

## Earlier Browser And Environment Evidence (not rerun in this follow-up)

QA doctor report:

`artifacts/qa/2026-10-11T01-50-33-168Z/qa-doctor.md`

Screenshot:

`artifacts/qa/2026-10-11T01-50-33-168Z/screenshots/qa-doctor-page.png`

Observed:

- Local candidate returned HTTP 200.
- Supabase URL and publishable key were present.
- Supabase REST endpoint was reachable.
- Chromium launched; `/auth` returned HTTP 200.
- Screenshot contained visible page content.
- No browser console or network error was captured.
- Current auth selectors passed.

Blocked:

- The authorized QA password was not available to the runner.
- No reusable verified session was available.
- Therefore the authenticated customer journey was not claimed as tested.

## Earlier Production Supabase Evidence (not revalidated in this follow-up)

Project `deepspec` is `ACTIVE_HEALTHY` on Postgres 17.

Production migration history includes:

- `20261010170625 v1_preview_billing_entitlements`
- `20261010170648 v1_preview_free_scan_usage`

Earlier transactional release checks proved the five-free-scan boundary, sixth-scan rejection, unverified-user rejection, reservation/finalization behavior, and cross-user protection. Test fixtures were rolled back; no production customer row was deleted.

The current Security Advisor reports seven INFO findings for RLS-enabled tables without client policies. Direct catalog verification shows all seven grant privileges only to `service_role`, not `anon` or `authenticated`:

- `dataset_members`
- `dataset_versions`
- `feedback_reviews`
- `free_scan_usage`
- `rate_limit_hits`
- `scan_credit_reservations`
- `scan_training_reviews`

These are intentional server-only tables. Adding broad client policies would weaken the intended access model.

Anonymous-access WARN findings remain on user-owned scan/storage/sync rows and public intake flows. Their policies are ownership-scoped or content-validated. Anonymous Auth is now disabled; do not broaden or delete those ownership checks merely to silence advisor warnings.

Leaked-password protection remains disabled and is a real dashboard hardening item. Supabase documents that it rejects passwords known through the Pwned Passwords service and is available on Pro and above:

https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Performance Advisor findings are debt, not a confidentiality blocker:

- Three unindexed foreign keys.
- Ten currently unused indexes.

Advisor results must be interpreted against the intended access model:

https://supabase.com/docs/guides/observability/advisors

## Supabase Key Rotation Runbook

Supabase is deprecating legacy `anon` and `service_role` keys by the end of 2026. New secret keys can coexist during migration and must remain server-only:

https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys

1. Create a named `sb_secret_...` key in Supabase Dashboard without displaying or copying it into chat, logs, source, or client variables.
2. Set it as `SUPABASE_SECRET_KEY` in Vercel Preview and Production server environments. Keep the legacy variable temporarily for rollback.
3. Redeploy a preview from the approved release commit.
4. Probe server-only consumers: entitlement read, scan credit reserve/finalize, billing webhook verification harness, reviewed-dataset export, and cloud save/read.
5. Confirm browser bundles and public environment output contain no server key.
6. Repeat the authenticated scan/save/history journey on the exact preview revision.
7. If any server probe fails, restore the prior deployment/environment selection while the legacy key is still active and investigate without deactivating it.
8. Only after every probe passes, deactivate the legacy key in Supabase. Supabase states this is reversible if a missed consumer appears.

Opaque secret keys must be sent in the `apikey` header, not as a bearer JWT. The export path now enforces that distinction.

## Reproducible Failures And Blockers

### P0: Exposed legacy server credential is still active

Expected: production server components use a newly created, independently rotatable secret key.

Actual: code is rotation-ready, but external key creation, Vercel installation, verification, and legacy deactivation are not complete.

### P0: Authenticated customer journey is unproven

Expected: a verified user can sign in, restore a session, scan, save, reopen history after refresh and logout/login, and receive correct backend persistence.

Actual: the QA doctor stops at missing password/session. No credential was searched for, printed, reset, or requested in chat.

### P0: Live provider completion is unproven

Expected: at least one configured provider completes an ordinary scan on the candidate revision with provider/model/run evidence.

Actual: unit and fallback tests pass, but no live provider call was made under the no-spending rule. Historical production probes included provider rejection, server failure, or rate limiting and are not launch evidence.

### P1: Supabase password hardening remains open

Expected: anonymous sign-ins disabled; leaked-password protection enabled when available.

Actual: anonymous sign-ins are now disabled and independently verified, while leaked-password protection remains disabled. The failed Linux jobs are being rerun through the evidence-only branch update.

### P2: Client payload weight

The build succeeds but includes a 550.87 kB minified Transformers.js chunk and a 23.6 MB ONNX WASM asset. This is a mobile performance risk to measure after the P0 gates close.

## Test Data And External Effects

- Production billing/free-scan test fixtures were transactional and rolled back.
- No account was created.
- No password was reset.
- No auth email was sent.
- No payment or paid provider call was made.
- No production deployment, merge, or manual promotion was performed. Vercel's GitHub integration automatically refreshed the branch preview.
- Production anonymous sign-ins were disabled with explicit user confirmation; signup and email authentication remained enabled.

## Shortest Remaining Launch Plan

1. Configure confirmed QA accounts as documented in `docs/CI_SETUP.md`; rotate the Supabase server key and harden Auth settings.
2. Produce one approved live provider success on the candidate preview.
3. Have the user enter the authorized account password directly into the browser, then run the full real website QA journey.
4. Re-run Security Advisor, full tests, lint, and build against the final revision.
5. Only then approve and promote the V1 preview.
