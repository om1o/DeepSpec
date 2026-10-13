# Disabled follow-up chat — PR #119

Scope: review threads PRRT_kwDOSd6dgM6rPMOw and PRRT_kwDOSd6dgM6rRfVL.
Inspected starting head: 459b0db116bbfe7630c15b90f85addfa39b90b66.
Integrated concurrent Result-only fix: 1a3ef93d35f617f0cab2af47cc9599fc51d65157.

## Changes

- The POST API handler evaluates the existing server-side chat switch before calling the limiter or session gate. Disabled requests retain the shared 503 `feature_disabled` response and `Cache-Control: no-store` without provider requests.
- The Vite development handler uses the same ordering. Enabled requests retain the existing rate-limit and session gates, provider configuration, fallback limits and token limits.
- New questions remain in memory until an answer succeeds. The question and answer are appended together, so disabled requests, pending requests, infrastructure failures and reloads cannot create a new unanswered saved question. In-page retry and retries of legacy unanswered history remain supported. Existing saved history is preserved.
- No deployment configuration or feature flags were changed. Production chat remains disabled by default.

## Verification

- Tests-first reproduction: 6 failures / 12 passes across the initial handler and component regressions before the implementation.
- Full ESLint (`npm run lint`), TypeScript (`npx tsc -b`), production build (`npm run build`) and public asset integrity passed on the integrated tree. The existing >500 kB Transformers chunk warning remains.
- Relevant suite: **6 files / 106 tests passed** (see focused-tests.log): API handler, shared chat, session gate, Chat component, AI service and storage.
- Handler tests cover default production disablement, explicit disablement, throwing infrastructure dependencies, no provider traffic, POST-only behavior, enabled rate-limit failures, authorization/configuration failures and successful authorized execution.
- Component tests cover disabled requests before/after unmount/remount, no pending or failed-question persistence, storage quota failure, existing conversation preservation, successful paired persistence, retry without duplication and account-change isolation.
- Actual local Vite HTTP request with `DEEPSPEC_ENABLE_CHAT=false` and `DEEPSPEC_REQUIRE_SESSION=true`, without configured authentication: **503**, `Cache-Control: no-store`, body `{"error":{"code":"feature_disabled","message":"Follow-up chat is unavailable in this beta."}}`.

## Limits

The default full-suite runner and an attempted process-based full-suite run stalled without results and were stopped; no whole-suite pass is claimed. Standard dependency installation failed on an ONNX native-binary network download. Dependencies were installed with lifecycle scripts skipped; native ONNX execution was not verified. Provider responses in regression tests are synthetic; no paid provider requests, live authentication, deployed-browser verification, merge or production promotion were performed. This scoped fix does not establish release readiness.
