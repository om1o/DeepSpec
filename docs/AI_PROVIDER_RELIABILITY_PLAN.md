# AI Provider Reliability Plan

Deep Spec should not depend on a live provider call for every QA check. Provider quota, temporary `429` responses, and API outages must be separated from model-quality failures.

## Release-Safe Rules

1. Scanner QA uses the real camera or upload path against the real identify path. There is no user-facing fixture mode; local smoke tests should upload a known image or use automated component tests.
2. `npm run eval:identify:release` is the live provider release check. It uses the fixed 50-case DrBimmer release set, reads local dataset files first, retries rate limits with long backoff, and stops after the configured provider availability failure count.
3. `npm run eval:identify:public` is the live provider public-launch check. It builds a deterministic 300-case sample from the local DrBimmer dataset index and writes the same safety and latency metrics.
4. Provider availability failures such as `rate_limited`, `network`, and `provider_error` are summarized as provider health failures. They are not written as training review rows because they do not prove the model was wrong.
5. Model-quality failures such as `invalid_response`, wrong results, vague results, or safety false positives are still written to `.deepspec-eval/identify-failures.jsonl` in the saved-scan review shape when they are reviewable.
6. Scanner production readiness requires both paths: real camera/upload smoke must pass consistently, and the live eval must pass its release threshold without provider availability blockers.
7. The Ollama identify fallback is local-development insurance only. It may run after all Gemini identify models hit retryable provider failures, but it does not replace the live provider release gate.

## Commands

```powershell
npm run check
npm run eval:identify:provider-health
npm run eval:identify:release
npm run eval:identify:public
npm run verify:supabase
```

Useful eval knobs:

```powershell
npm run eval:identify:provider-health
npm run eval:identify -- --sample-size 6 --delay-ms 30000 --max-provider-failures 1
npm run eval:identify -- --sample-size 50 --delay-ms 0 --dataset-root datasets/raw/drbimmer-car-parts-and-damage-dataset
npm run eval:identify -- --sample-set public --sample-size 300 --delay-ms 0 --provider-timeout-ms 90000 --max-provider-failures 1
```

`DEEPSPEC_DATASET_ROOT`, `DEEPSPEC_DATASET_INDEX_PATH`, `DEEPSPEC_EVAL_DELAY_MS`, `DEEPSPEC_EVAL_MAX_PROVIDER_FAILURES`, `DEEPSPEC_IDENTIFY_PROVIDER_TIMEOUT_MS`, `GEMINI_FALLBACK_MODELS`, and `GEMINI_CHAT_FALLBACK_MODELS` can set the same defaults for release runs.
For a fast provider smoke where rate limits should fail immediately instead of waiting through release backoff, add `--rate-limit-retries 0`.
`npm run eval:identify:provider-health` is the standard fast smoke for that case. It writes `artifacts/release-gates/provider-health-summary.json` and exits `2` when provider quota or availability blocks the release gate.

Optional local identify fallback:

```powershell
ollama pull llava
$env:DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK="true"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"
$env:OLLAMA_IDENTIFY_MODEL="llava:latest"
```

This fallback is useful when a developer machine has Ollama running and Gemini returns `429` or another retryable provider failure. It is not a production guarantee unless the backend can reach that Ollama host.

The summary at `.deepspec-eval/identify-summary.json` includes provider and total latency percentiles, invalid response rate, safety false-positive rate, pass rate, and provider availability failure rate.
