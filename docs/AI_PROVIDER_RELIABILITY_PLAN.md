# AI Provider Reliability Plan

Deep Spec should not depend on a live provider call for every QA check. Provider quota, temporary `429` responses, and API outages must be separated from model-quality failures.

## Release-Safe Rules

1. `/scan?test=1` uses the bundled engine photo and a fixed QA result. It proves the scanner/result UI without spending provider quota or writing history, cloud rows, or training review data.
2. `npm run eval:identify:release` is the live provider beta release check. It uses the fixed 50-case DrBimmer release set, throttles provider calls, honors bounded provider `Retry-After` timing when it is shorter than the default backoff, and stops after the configured provider availability failure count.
3. `npm run eval:identify:public` is the public-launch confidence gate. It builds a deterministic 300-sample set from the verified DrBimmer Hugging Face tree, balanced across 150 damage images and 150 part images, then verifies that at least 300 samples were attempted and passed.
4. Provider availability failures such as `rate_limited`, `network`, and `provider_error` are summarized as provider health failures. They are not written as training review rows because they do not prove the model was wrong.
5. API `429` responses preserve sanitized retry timing as `retryAfterSeconds` when the provider sends a valid `Retry-After` header, so scan/chat UX can tell users when to retry instead of showing a generic quota message.
6. Eval summaries must include launch metrics: accuracy, invalid response rate, provider failure rate, retry count/rate, latency distribution, and rule-derived safety false positives.
7. Model-quality failures such as `invalid_response`, wrong results, or vague results are still written to `.deepspec-eval/identify-failures.jsonl` in the saved-scan review shape.
8. Scanner production readiness requires the QA fixture, the beta eval, the public-launch eval, and the cloud verifier to pass without provider or Supabase availability blockers.

## Commands

```powershell
npm run check
npm run eval:identify:release
npm run eval:identify:public
npm run verify:supabase
```

Useful eval knobs:

```powershell
npm run eval:identify -- --sample-size 6 --delay-ms 30000 --max-provider-failures 1
```

`DEEPSPEC_EVAL_DELAY_MS` and `DEEPSPEC_EVAL_MAX_PROVIDER_FAILURES` can set the same defaults for release runs.
