# AI Provider Fallback Plan

Deep Spec needs a real backup path for `/api/identify` when Gemini returns `429`, network failures, or retryable provider errors. Gemini invalid JSON or weak model output should remain a model/prompt failure, not something silently hidden by fallback. The goal is to keep the user flow recoverable, preserve dataset evidence, and prove each provider with separate gates.

## Current State

- Primary identify provider: Gemini through `api/identify.shared.ts`.
- Existing fallback: another Gemini model from `GEMINI_FALLBACK_MODELS`.
- Optional local fallback: Ollama, disabled by default and not a release guarantee.
- Current blocker: provider health smoke reports both configured Gemini models returning `429 rate_limited`.
- Existing gates:
  - `npm run eval:identify:provider-health`
  - `npm run eval:identify:release`
  - `npm run verify:identify-eval`

## Backup Provider Direction

Use Hugging Face as the first non-Gemini backup because it can route to multiple hosted inference providers and can also support dedicated Inference Endpoints later.

Candidate vision-language models from Hugging Face search:

| Tier | Candidate | Why it fits | Risk |
| --- | --- | --- | --- |
| Fast fallback | [Qwen/Qwen2.5-VL-3B-Instruct](https://hf.co/Qwen/Qwen2.5-VL-3B-Instruct) | High-download image-text model, smaller and cheaper for first backup attempts. | May be weaker on exact automotive parts. |
| Strong fallback | [Qwen/Qwen2.5-VL-7B-Instruct](https://hf.co/Qwen/Qwen2.5-VL-7B-Instruct) | High-download image-text model with better reasoning budget than 3B. | More latency and cost than 3B. |
| Dedicated endpoint candidate | [Qwen/Qwen2.5-VL-7B-Instruct-AWQ](https://hf.co/Qwen/Qwen2.5-VL-7B-Instruct-AWQ) | Quantized variant tagged endpoint-compatible. | Needs endpoint benchmarking before release use. |

Hugging Face `InferenceClient` supports image-plus-text chat completion with a base64 image URL and can route through hosted Inference Providers or a dedicated Inference Endpoint. That makes it a practical API backup without adding a browser-side secret.

## Provider Order

1. Gemini primary model.
2. Gemini fallback models.
3. Hugging Face routed inference, disabled unless `HF_TOKEN` and `DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK=true` are set.
4. Dedicated Hugging Face Inference Endpoint, preferred for beta if routed inference is inconsistent.
5. Local Ollama only for local development, never as a release gate substitute.

## Implementation Steps

1. Add provider configuration:
   - `DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK`
   - `HF_TOKEN`
   - `HF_IDENTIFY_MODEL`, defaulting to `Qwen/Qwen2.5-VL-7B-Instruct`
   - `HF_IDENTIFY_PROVIDER`, defaulting to Hugging Face auto routing
   - `HF_IDENTIFY_ENDPOINT_URL` for a dedicated endpoint override

2. Add a provider adapter in `api/identify.shared.ts`:
   - Reuse the same system prompt and JSON shape.
   - Send image input as an image URL data URI plus text instructions.
   - Normalize the response through the existing `normalizeIdentificationResult`.
   - Return the same error codes: `rate_limited`, `network`, `provider_error`, and `invalid_response`.
   - Only invoke HF after provider availability failures from Gemini, not after Gemini `invalid_response`.

3. Preserve dataset fields:
   - Store `provider`, `model`, `latencyMs`, and fallback reason in `scan_model_runs`.
   - Keep the final normalized result shape identical across providers.
   - Do not save provider-only raw text as trusted evidence unless it maps into the schema.

4. Add gates:
   - `npm run eval:identify:hf-health` for one no-retry HF provider smoke.
   - `npm run eval:identify:provider-health` remains the Gemini provider smoke.
   - `npm run eval:identify:release` must still fail if the backup provider is unavailable or model quality drops.

5. Add tests:
   - Gemini `429` falls through to HF only when enabled.
   - Missing `HF_TOKEN` skips HF and returns the original provider failure.
   - HF valid JSON normalizes into the existing result schema.
   - HF invalid JSON becomes `invalid_response` and writes a reviewable eval row.
   - Release eval summary distinguishes Gemini blocked, HF blocked, and model-quality failures.

## Release Rules

- Do not hide a provider outage by calling a weaker backup "good enough."
- Do not enable HF fallback in production until at least the 50-case release eval passes with the fallback path forced.
- Keep `provider-health` fast and cheap; use it before a full 50-case run.
- Keep full release eval as the real standard: provider available, all requested samples attempted, and no reviewable failures.

## Rollout Order

1. Implement the HF adapter behind env flags.
2. Run a one-sample HF health smoke.
3. Force Gemini failure in tests and prove HF fallback works.
4. Run a 6-sample diagnostic with HF fallback enabled.
5. Run the 50-case release eval with fallback enabled.
6. Only then consider a dedicated HF endpoint for lower latency and more predictable capacity.
