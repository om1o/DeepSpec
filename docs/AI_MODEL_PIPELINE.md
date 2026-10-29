# DeepSpec's actual AI pipeline

This documents the existing app code, not a promise that every model runs on every scan. The defaults contain nine distinct model IDs. Configured providers can replace those IDs; the pipeline chooses providers and falls back rather than calling every model in parallel.

| Model | Existing role | Where it runs / what enables it |
| --- | --- | --- |
| `gemini-2.5-flash` | Photo identification, visible problems, follow-up chat | Server `GEMINI_API_KEY`; configurable identify/chat model variables |
| `gemini-2.5-flash-lite` | Gemini availability fallback / identify hedge | Same server key; configurable fallback lists |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Groq vision provider, tried before Gemini when enabled | `DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK=true` and `GROQ_API_KEY` |
| `Qwen/Qwen2.5-VL-7B-Instruct` | OpenAI-compatible Hugging Face fallback | `DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK=true` and `HF_TOKEN` or supported token alias; endpoint/model can select OpenRouter instead |
| `llava:latest` | Emergency local Ollama vision fallback | Explicit local fallback flag and a running Ollama endpoint; not a bundled cloud model |
| `microsoft/trocr-large-printed` | Read printed labels, stamped text and part numbers | Label/text request or blurry-label rescue plus a Hugging Face token |
| `Xenova/slimsam-77-uniform` | Isolate the selected part and scene objects | Browser WebGPU, on by default; `VITE_DEEPSPEC_PROMPTABLE_SEG=off` disables it |
| `onnx-community/MVANet-ONNX` | Background-removal fallback when SAM cannot isolate the target | Browser WebGPU, on by default; `VITE_DEEPSPEC_SEGMENTATION=off` disables it |
| `Xenova/clip-vit-base-patch32` | Limited, explicitly labelled on-device estimate | `VITE_ENABLE_ON_DEVICE_FALLBACK=true`; disabled by default, never a substitute for a configured cloud analysis |

SAM and MVANet download their weights into the visitor's browser from the configured model host. They do not require a desktop model folder to be copied to the website. Unsupported WebGPU devices use a crop or full photo. Visual preparation has a short budget so isolation cannot block identification; a cold download can finish after the first scan has already used a crop.

OCR is optional and genuine extracted text is retained as `OCR label text:` evidence, including when the vision answer already has six evidence entries. An HF/OpenRouter-only configuration can now run without a Gemini key; the actual fallback failure is preserved rather than reported as a missing Gemini key.

## Follow-up photo and research

The full chat attaches the saved JPEG/PNG/WebP photo to the vision-capable Gemini request. Signed cloud-history images are loaded and bounded in the visitor's browser with the existing retry-frame utility. Attachments are data URLs; the server never fetches arbitrary photo URLs. An unavailable photo produces an explicit refresh/retake error instead of silently dropping image context. The account scope is checked again after asynchronous photo/auth loading, so an old scan cannot be sent with a newly switched account's token. Older text-only API callers remain supported.

Ordinary chat uses the photo and saved observations. Explicit **Research** adds real Gemini Google Search grounding and URL context. Only provider grounding metadata or successfully retrieved URL metadata becomes a research source card. A generated URL in the answer is not promoted to a verified source. Google search suggestions are returned separately for isolated display in the current chat and are not persisted as provider HTML.

YouTube URLs can be supplied as reference links. Google Search may return indexed video references. URL context does not watch YouTube videos, and the prompt explicitly prevents claiming that a linked video was watched. Direct video understanding is a different API input and is not enabled here.

Research references use public HTTPS URLs, with up to three explicit references. The backend preserves answer paragraphs and supports a bounded detailed response. Stored assistant messages retain paragraphs and their source links; user question and account/guest storage boundaries remain unchanged.

The presence of code does not establish live provider readiness. A successful real image request and follow-up request against the deployed server are required before claiming cloud identification or research works. No sample answer is substituted when credentials are unavailable.

## Provider references

- [Gemini Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search)
- [Gemini URL context and its limits](https://ai.google.dev/gemini-api/docs/url-context)
- [GenerateContent Tool schema](https://ai.google.dev/api/generate-content#Tool)
- [YouTube video input](https://ai.google.dev/gemini-api/docs/video-understanding#youtube)
- [Associated search suggestion display requirements](https://ai.google.dev/gemini-api/terms#grounding-with-google-search)
