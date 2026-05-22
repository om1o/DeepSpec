# Hugging Face Dataset Research

Research date: May 22, 2026

## Purpose

Deep Spec needs a repeatable car-part and damage dataset path for three jobs:

1. Release evals that do not drift between runs.
2. Local retrieval hints that improve result evidence and ranked alternatives.
3. Future training or fine-tuning data once Supabase scan persistence is proven.

## Current Source

`DrBimmer/car-parts-and-damage-dataset` remains the safest release baseline.

- Hugging Face link: https://hf.co/datasets/DrBimmer/car-parts-and-damage-dataset
- License: MIT.
- Shape: 1,812 high-resolution images with polygon segmentation for car parts and damages.
- Current use: `scripts/eval-identify.mjs`, `scripts/sort-drbimmer-dataset.mjs`, and local dataset evidence lookup.
- Release value: stable enough for fixed 50-case evals and already covered by tests.
- May 22 release proof: `npm run eval:identify:release` passed 50/50 fixed samples with provider available, 0 provider failures, and 0 failure review rows.
- Connector proof: Hugging Face metadata confirmed the dataset tags include object detection and image segmentation.

## Candidate Expansion Sources

| Dataset | Observed value | Risk | Recommendation |
| --- | --- | --- | --- |
| `mitbersh/car-parts-segmentation-yolo` | Larger YOLO segmentation export for car parts, listed as `10K<n<100K`, with strong current download signal. | Labels and format differ from the current DrBimmer importer; documentation is partly non-English. | Add as the first importer candidate after Supabase verification passes. |
| `moondream/car_part_damage` | Embedded-image parquet dataset with COCO-like boxes and polygons for car part damage. | License is listed as unknown. | Useful for eval research only until license is clarified. Do not train on it yet. |
| `SaiVaibhavS/comprehensive-car-damage` | MIT image-classification dataset for front/rear normal, crushed, and breakage classes. | Damage classification only; not a fine-grained part identifier. | Use as a damage-triage eval supplement, not as a replacement for part detection. |
| `stevenalbert10/Toyota-Corolla-Car-Parts` | Engine-compartment object-detection dataset tied to an AR maintenance app. | Narrow vehicle/domain scope. | Useful for engine-bay part regression cases such as alternator, belt, battery, and fuse-box scans. |
| `AshimaVinod/car-parts-and-damage-dataset` | Recent fork or mirror of the current DrBimmer-style dataset. | Likely duplicate lineage; adds maintenance risk without obvious new labels. | Do not switch release evals to this unless it proves new data or fixes missing files. |

## Release Decision

Do not change the release eval dataset before the Supabase blocker is fixed.

Reasons:

- The release needs stable evidence, not another moving part.
- `DrBimmer/car-parts-and-damage-dataset` is already wired into tests and summary verification.
- Supabase anonymous Auth still blocks real cloud dataset persistence, so a larger dataset will not close the main production gap.

## Next Implementation Steps

1. Keep `DrBimmer/car-parts-and-damage-dataset` as the fixed release eval source.
2. Add importer interfaces only when there are at least two real importers; do not abstract for a single source.
3. After `npm run verify:supabase` passes, add a `mitbersh/car-parts-segmentation-yolo` importer as a separate script with its own derived output folder.
4. Add a damage-triage eval supplement from `SaiVaibhavS/comprehensive-car-damage` only for damage/normal classification, not primary part naming.
5. Record dataset license, source URL, split, source image URL, labels, and conversion version in every derived record.

## Verification Standard

A dataset source is ready to affect release behavior only when all of these are true:

- The importer is deterministic and covered by tests.
- The derived records include source links and label provenance.
- The release eval has a fixed sample list.
- Wrong, vague, invalid-response, and provider-availability failures are separated in the summary.
- The source license is acceptable for the intended use.
