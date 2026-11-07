# Verified Source Policy

Deep Spec must not present exact vehicle, engine, or part identity as verified unless the match is backed by a source that can be traced to a manufacturer, government dataset, licensed service-information provider, or a user-confirmed scan record.

## Verified Source Tiers

- `tier_1_government`: Government vehicle identity, recall, and safety data. Use NHTSA vPIC/VIN data for make, model, model year, body, engine fields, plant, and manufacturer-reported VIN decoding. Use NHTSA recall data for safety recall context.
- `tier_1_oem`: Manufacturer-owned sources such as Toyota, Ford, GM, Honda, or other OEM parts catalogs, owner manuals, service information portals, and technical service sources.
- `tier_2_licensed`: Licensed professional repair or parts platforms that source OEM data and permit app usage under their terms.
- `tier_3_user_verified`: Deep Spec scans corrected or confirmed by users, with the original image, model answer, correction, confidence, timestamp, and review status preserved.
- `unverified_reference`: Public web pages, forums, marketplace listings, social media, scraped images, or open datasets without clear provenance and license rights.

## Product Rules

- Exact claims require evidence. "Toyota 2AR-FE alternator" needs visible image clues plus at least one verified source signal such as VIN decode, OEM diagram, OCR label, part number, or user-confirmed record.
- If the source is not verified, the UI must say `likely`, show a confidence range, and avoid exact fitment language.
- NHTSA can verify vehicle identity fields from VIN data, but it is not a labeled engine-photo dataset. It should constrain the search space, not replace visual matching.
- OEM and service manual sources can verify part names, diagrams, service positions, and fitment, but their copyright and terms must be respected. Store source metadata and links unless license rights explicitly allow storing or training on images.
- User-approved scan photos are the safest training source. They must keep consent/training status separate from ordinary save history.

## Scanner Matching Flow

1. Detect the object and major surrounding parts from the scan photo.
2. Extract text from visible labels, stickers, cast numbers, part numbers, and engine-cover markings.
3. If VIN, year/make/model, or user vehicle context exists, use it to narrow the candidate set.
4. Retrieve candidates from verified source metadata first, then compare against user-verified scan records.
5. Return the most specific answer the evidence supports.
6. Show the evidence: source tier, source name, matched clue, confidence range, and whether one more photo is needed.

## Data Fields Needed

### Offline reference-builder output

`scripts/build-verified-vehicle-reference.mjs` emits two distinct record kinds. A fetched `vehicle_model_year` record must match both the requested make and model and remains `constrained`, not visual proof or exact-part fitment. A malformed upstream response is an error, not evidence of no matching vehicles.

A `source_pointer` is an unfetched link for manual review. It is `unverified`, has no `sourceRetrievedAt`, and records only when its metadata was generated. Manufacturer portals are scoped to their manufacturer; a general source has no vehicle scope. They do not inherit the requested model or year and cannot verify fitment. Toyota portals must not appear as applicable sources for other makes. Existing generated files with `verified_source_pointer` records should be regenerated into a fresh output directory before use; the builder does not retrofit old datasets or remove stale label-index files from reused directories.

Public hosting alone does not establish document applicability or unrestricted reuse. Before adding a document, review its type, vehicle/engine/VIN qualifiers, revision or expiry, conflicting/superseding instructions and reuse terms. Manufacturer communications may include research requests, warranty notices and service campaigns, not only repair procedures. Do not copy a restricted bulletin into AI retrieval storage merely because it is publicly readable. [NHTSA data definitions](https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS.txt), [NHTSA terms](https://www.nhtsa.gov/about-nhtsa/terms-use)

These offline datasets are not a live repair-reference integration. The current app's vehicle-reference endpoint remains NHTSA identity lookup; licensed OEM diagrams and procedures still require an appropriate source and verified applicability.

### Record fields

- `sourceTier`
- `sourceName`
- `sourceUrl`
- `sourceLicense`
- `sourceRetrievedAt`
- `sourceVehicle`
- `sourcePartName`
- `sourcePartNumber`
- `sourceEngineCode`
- `evidenceClues`
- `verificationStatus`: `verified | constrained | user_confirmed | unverified`
- `trainingAllowed`

## Rejected Behavior

- Do not train on copyrighted manuals, diagrams, or OEM images unless usage rights are confirmed.
- Do not call forum, marketplace, or scraped-image matches verified.
- Do not claim exact engine, trim, or replacement size from one photo when the required evidence is missing.
- Do not hide uncertainty. A verified workflow can still output `not enough evidence`.
