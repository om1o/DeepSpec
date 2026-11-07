# Photo-specific observation areas

An observation can open its exact cited original and show an optional AI-suggested rectangle. A possible cause links to its supporting observations; the app does not invent a location for a cause. Original view hides all outlines. These pointers do not establish damage boundaries, measurements, severity, cause or function.

## Data and provider contract

`conditionAssessment.version: 2` adds optional observation `areas: [{ photoId, rectangle: { x, y, width, height } }]`. Coordinates are normalized to the entire cited saved image, with a top-left origin. Each observation may have at most one rectangle for each of its cited photos. Coordinates must be finite, positive in size and wholly within the image. Empty or absent areas mean no location was supplied. Invalid optional assessments are omitted while the core identification survives; coordinates are never inferred from text or silently converted/clipped.

Version 1 remains text-only. The new prompt and pipeline versions fence prior cached answers. Normal and compact-rescue prompts use the same optional geometry contract across Gemini, Hugging Face, Groq and Ollama. The compact response may omit areas. Transport tests use synthetic responses and do not establish model localization accuracy or live account access.

Older clients reject v2 assessments. An older client can subsequently lose that optional assessment in a full scan save. Do not silently downgrade it. Roll out compatible clients together before relying on this field across devices.

## Human review

Human marks are separate from the AI answer and first-photo part isolation. Each mark binds a frozen observation, full answer fingerprint, attempt ID when present, exact photo ID, original byte digest, dimensions and saved source context. A new mark requires the current saved answer and original. A historical correction can retain the old claim after an AI retry if its original pixels and photo context still match. A retraction adds no geometry and can preserve history even when the original is unavailable.

Marks, corrections and retractions form immutable chains. Competing heads are retained without selecting a winner or active outline. One unfinished draft per account/scan prevents another claim from replacing entered work. The final IndexedDB transaction checks the expected draft and history head, asserts source/account freshness, appends the exact record and retires that draft atomically. Failed writes retain recovery data. History is bounded to 100 records / 256 KiB per scan; exceeding limits rejects the write without truncation.

Evidence DB v8 adds `observation-areas` and `observation-area-drafts`. Existing stores remain. A v7 tab closes its connection on upgrade, but subsequent v7 opens fail until it reloads; it may still edit scan data outside IndexedDB. Source guards therefore remain necessary. Human area history is device-only and is not a cloud backup. No shared SQL migration is required by this change.

## Reports and limitations

HTML keeps embedded original pixels unchanged and renders outlines separately. Only current, non-conflicting human marks with verified embedded originals appear as active overlays. Earlier marks, retractions and unavailable-source history remain readable. A changed AI answer is labeled separately from photo-byte identity. Reports exclude dedicated private identity fields by default; free-text area notes are included and may contain identifiers.

AI rectangles remain unverified suggestions. The saved AI answer has no provider-time image checksum, and matching files do not establish localization correctness. Real car photos, mechanic review, live provider testing and the user's iPad are still required before any accuracy or improvement claim.

## Design sources

- [W3C Media Fragments, spatial dimension](https://www.w3.org/TR/media-frags/#naming-space): top-left rectangular coordinates relative to original media. DeepSpec uses its own named normalized 0–1 JSON fields, not the standard's URI syntax.
- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/#specific-resources): separate the annotation from its specific source target. This is a design reference, not a claim that the internal format is W3C-conformant.
- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding): Google's documented bounding-box format differs from this application's contract. The prompt explicitly specifies our named fields; the parser does not guess coordinate formats.

These references informed the design. No third-party implementation code or assets were copied. Native validation uses explicitly labeled synthetic drawings and the production Result/report components, without an AI provider, hosted authentication or a real vehicle.
