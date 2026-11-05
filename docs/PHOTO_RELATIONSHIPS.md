# Photo relationships

A group of uploaded images is not evidence that they show one part, one vehicle or a before-and-after sequence. The earlier prompt asserted that the user had reported the same part without recording that statement. This change records the user's choice before analysis and keeps it separate from model-generated findings.

`photoRelationship` is optional on requests, saved scans and visual evidence bundles; modern draft envelopes require an explicit value:

- `same_part_or_area`: the user reports the same part or area of one car. This is not independently verified; incompatible views still need to be called out.
- `independent`: each photo is an independent example. Do not combine identities, condition, vehicle facts or chronology across them.
- `unknown`: no relationship has been established. Older records and requests with no declaration have this meaning.

The review screen records the choice without starting AI. Relabeling a view preserves it; adding, removing, replacing or reordering source photos clears it to unknown. Transactional draft comparisons include the declaration, so an older tab cannot overwrite a newer relationship using identical image bytes. Saved scans retain their original declaration through retries, local reopening, cloud evidence serialization and reports. There is no saved-record relationship editor in this slice.

New draft versions 5/6/7 mirror the basic, vehicle-context and comparison shapes of legacy versions 2/3/4. Legacy reads remain supported, while writes upgrade to the corresponding modern version. Older clients reject these versions instead of dropping the new declaration and overwriting or deleting its draft.

Explicit invalid values are rejected at request/storage boundaries. Missing legacy values remain usable and are never upgraded to a same-part assertion. Photo labels such as Overview or Other do not imply a relationship.

## Analysis scope

The same metadata is used for normal identification, compact rescue, existing fallback routes and follow-up chat, including older unlabeled image inputs. Every supplied image retains its identifier and position. For independent or unknown groups, primary identification and geometry apply to Photo 1, and supplied vehicle details must not be attributed to another photo. Claims about other photos must identify their evidence separately. The relationship travels outside the capped chat-history text.

Model selection, output limits, request counts, authentication and scan allowance are unchanged. The identification prompt and pipeline versions change so older cached answers are not treated as answers under these semantics.

Reports attribute independent/unknown primary identification to Photo 1 for the recognized `identify-pipeline-2026-11-05-photo-relationship-v1` and `identify-pipeline-2026-11-05-photo-review-v1` versions. Older, unknown or absent pipeline provenance is described as unrecorded per-photo identity scope; a record without a result has no identification. Selection and supplied car details or complaint remain scoped to Photo 1. Secondary independent/unknown photos do not inherit Photo 1's vehicle context when used in comparisons or diagnostic associations. Existing historical snapshots remain unchanged and fail source verification when that inherited context no longer matches.

The optional [photo review contract](PHOTO_REVIEW.md) now records which image entries the model returned, limited or unassessed views, and reported disagreements with targeted next evidence. Missing rows remain unreported; complete or accurate review is not guaranteed. The structured review travels outside the follow-up prose budget, while other detailed saved prose can still be omitted. This does not add secondary-photo geometry, prove multi-angle accuracy, establish chronology, or verify physical condition or function. Saved images can include derived crops; separate image entries do not establish separate capture angles.

## Persistence and release

The existing version-1 evidence JSON can carry the optional declaration; no new schema migration or dependency is added. Cloud use still depends on the earlier evidence-bundle migration and normal access controls. The cloud-off Preview path remains supported. Serialization tests are not hosted cloud acceptance.

This branch is a separate draft source change. Automatic Vercel deployment is disabled. PR #138 and its exact pending live-test proposal remain fixed; this work does not replace that candidate or authorize any credential/configuration/deployment change.

## Sources and validation

- [Google's multiple-image guidance](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding) describes supplying multiple images in one request; its current redirected examples use Interactions. The [generateContent API reference](https://ai.google.dev/api/generate-content) documents the Content.parts/inlineData shape retained here. DeepSpec keeps explicit captions/IDs beside the images. The relationship contract and safeguards are application design decisions, not an accuracy guarantee from that documentation.
- [Supabase JSON documentation](https://supabase.com/docs/guides/database/json) describes storing and validating JSON metadata. This patch extends the application's existing evidence object and validates its enum before use; it adds no database/API convention.
- [Supabase changelog](https://supabase.com/changelog) was checked on November 5, 2026. No CLI, authentication, table exposure, SDK version or hosted schema is changed by this slice.

Regression coverage checks invalid/missing declarations, provider prompts/transport, stale draft changes, immutable retry metadata, local/cloud serialization and report scope. Native browser receipts and CI results are recorded separately after execution. No third-party code, model weights or automotive images are copied by this change.
