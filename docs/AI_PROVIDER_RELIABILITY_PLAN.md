# AI Provider Reliability Plan

Deep Spec should not depend on a live provider call for every QA check. Provider quota, temporary `429` responses, and API outages must be separated from model-quality failures.

## Release-Safe Rules

1. `/scan?test=1` uses the bundled engine photo and a fixed QA result. It proves the scanner/result UI without spending provider quota or writing history, cloud rows, or training review data.
2. `npm run eval:identify` is the live provider release check. It throttles provider calls, retries rate limits with long backoff, and stops after the configured provider availability failure count.
3. Provider availability failures such as `rate_limited`, `network`, and `provider_error` are summarized as provider health failures. They are not written as training review rows because they do not prove the model was wrong.
4. Model-quality failures such as `invalid_response`, wrong results, or vague results are still written to `.deepspec-eval/identify-failures.jsonl` in the saved-scan review shape.
5. Scanner production readiness requires both paths: the QA fixture must pass consistently, and the live eval must pass its release threshold without provider availability blockers.

## Commands

```powershell
npm run check
npm run eval:identify
npm run verify:supabase
```

Useful eval knobs:

```powershell
npm run eval:identify -- --sample-size 3 --delay-ms 30000 --max-provider-failures 1
```

`DEEPSPEC_EVAL_DELAY_MS` and `DEEPSPEC_EVAL_MAX_PROVIDER_FAILURES` can set the same defaults for release runs.
