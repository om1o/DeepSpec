# Per-photo review and disagreements

An identification result alone does not establish that every submitted image was assessed. The optional version-1 `photoReview` block records model-reported observations and limitations against the exact submitted photo IDs. It is independent of `conditionAssessment`, the user's declared photo relationship, and the main identification.

## Contract and presentation

- `photos` contains 1–4 unique submitted IDs. Each row has `observations_returned`, `limited_view` or `not_assessed`, plus a nonempty summary of at most 360 characters.
- `disagreements` contains at most two items with unique IDs. Each cites 2–4 distinct returned rows, excluding `not_assessed`. Description is at most 360 characters; the targeted next-evidence request and its purpose are each at most 240.
- IDs use 1–80 ASCII letters, digits, dots, underscores, colons or hyphens. References to absent images, duplicate rows or malformed fields invalidate the entire optional block. The main answer, safety action and saved images remain independent.
- Omitted photos display **No review returned**. An absent block is unreported; no row is inferred from a successful request, condition assessment or pipeline version. An explicitly unassessed row remains **Not assessed**. Counts describe entries, not completed inspections.
- Empty disagreements means none were reported, not verified agreement. Every disagreement includes the image references and the next evidence needed to investigate it. Content is plain text, never interpreted as HTML.

The panel is available in the scan workspace, result page and chat evidence workspace. Links select the exact saved image ID. Scanner and Result switch the viewer to its Original mode, bypassing cutouts and display outlines; this means the saved input pixels, not proof that an image is a separate camera capture. Legacy crop-assisted requests can contain a derived crop as Photo 2, and source-kind provenance is not recorded. The panel and reports state that saved images may include crops and that separate angles are unverified. Clicking references does not request another analysis.

## Provider and conversation handling

Identification prompts request concise optional review in normal, compact rescue and existing fallback paths. Strict, coerced and local-model parsing normalize it against the actual input IDs. Invalid optional content does not alone trigger another provider request. Required identification and safety fields take priority within the existing output limits; omission is allowed.

The prompt and pipeline markers are `identify-2026-11-05-photo-review-v1` and `identify-pipeline-2026-11-05-photo-review-v1`. Both the prior relationship marker and this new marker retain known Photo 1 identity scope for independent/unknown groups. Older or unrecognized provenance remains unrecorded, never retroactively upgraded.

Follow-up chat sends the validated block separately from the 3,000-character prose budget. The server validates it again against attached images and describes it as saved AI-reported data, not instructions, human confirmation or current observations. Omitted image IDs and lack of disagreement verification remain explicit. Model choices, API endpoints, output budgets and request counts are unchanged; no provider response schema or additional call was introduced.

## Persistence and reports

Local save, reopening, retry, recovery, cloud result JSON and report restoration validate the optional block against the actual image IDs. A retry replaces the prior result and review together; reviews from different attempts are never combined. Cloud URL refresh retains the local analysis. The single-image cache accepts review only for the sole `photo-1` input and retains original model-run provenance. The cache cannot invent or relabel extra input IDs.

Text and HTML mechanic handoffs use the same coverage/uncertainty formatter. HTML links rows and disagreements to the saved images and escapes all text. Invalid direct input gets an explicit unavailable-review notice; normalization may remove an invalid block before saving, after which it is honestly shown as unreported. This slice does not retain a rejection-audit record.

This optional field uses existing JSON persistence without a schema migration or dependency change. Old app versions may strip optional metadata when rewriting a saved record; absence remains unreported, but this slice does not add a saved-record version fence. Device and cloud availability rules are unchanged.

## Sources and acceptance

Reviewed November 5, 2026:

- [Google image understanding](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding): multiple image parts can be supplied in one request. Explicit application IDs/captions keep references aligned; this is not evidence that the model assesses every part correctly.
- [Google structured output guidance](https://ai.google.dev/gemini-api/docs/generate-content/structured-output): structured syntax does not guarantee semantically correct values. This implementation retains JSON MIME plus local validation; it does not adopt a new provider schema or endpoint.
- [Supabase JSON documentation](https://supabase.com/docs/guides/database/json): JSON can carry nested metadata. Existing authenticated result persistence is reused; serializer tests are not proof of a hosted round trip.

The application contract, validators and presentation are original work. No third-party code, assets, automotive datasets or model weights are copied. Synthetic drawings and hand-authored results may verify UI/persistence/export mechanics only; they do not verify live AI quality, real-car accuracy or iPad capture.

Release requires CI plus native UI/persistence/export checks, recorded separately. Actual provider review quality, omitted-view frequency and disagreement usefulness require live benchmark evidence. This source branch is a draft stacked on the photo-relationship work with automatic deployment disabled. It does not replace the frozen PR #138 live-test candidate or authorize credentials, deployment, hosted writes, migrations or a merge.
