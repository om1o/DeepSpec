# Vehicle details and photo snapshots

Vehicle details are supplied by the user. A field becomes user-confirmed only
after an explicit action against its exact value. Changing a field clears that
confirmation; mileage confirmation includes the unit, and modification
confirmation includes both status and details. Missing, unknown and legacy
values do not become confirmed automatically. A VIN is entered information,
not a decoder result or proof of fitment.

The shared normalizer preserves mileage, its unit, modification uncertainty,
symptoms and existing shop context through local and cloud scan restoration.
It strips stale confirmation metadata rather than attributing confirmation to
an edited value. The provider projection contains relevant vehicle facts and
the reported complaint, excluding customer/plate/technician/job identifiers and
generic notes. A complaint is explicitly separate from a visual observation.

## Capture and recovery

The selected car is an account-scoped preference saved on the current device.
It does not rewrite existing scans or synchronize a reusable garage profile.
New camera and upload groups save a version-three draft containing the vehicle
snapshot and optional original job ID before provider analysis. Component
capture obtains that snapshot from its overview. Subsequent profile or job
edits cannot change the group being resumed.

Version-two drafts and legacy photo arrays remain readable. They are not
silently assigned the newly selected car. Older component drafts can recover
context from their original overview; ordinary legacy drafts have no saved
vehicle context. Version-three metadata is required and old version-two
wrappers cannot relabel or delete it. Draft comparisons include the version,
photos, component target, vehicle snapshot and job ID.

When adding another angle, both the authoritative stored draft and the draft
currently shown to the user must still match. If another tab has replaced the
group, the new file is not appended to that other inspection. Reserved scan
recovery likewise requires matching photo, vehicle and job evidence.

Identification, selected-object analysis, retakes and normal/research follow-up
questions receive the saved context. Contextual requests bypass the image-only
cache. A saved shop report uses the frozen vehicle/complaint snapshot, and the
scan is attached to its original job rather than whichever job is open later.
Text exports include vehicle details and symptoms even without a condition
assessment. Provider metadata and report wording retain the distinction between
supplied, self-reported user-confirmed and unknown information.

## Limits and validation

Confirmation is a user assertion, not third-party verification. It narrows
candidate identification; it does not establish exact part fitment, mechanical
condition or serviceability. Advice that depends on an uncertain vehicle detail
must request that detail first. General visual identification remains possible
without a complete profile.

Regression checks cover stale confirmations, changed units/modifications,
legacy records, account changes, metadata loss, provider transport, vehicle/job
switches, concurrent draft replacement and exports. Native browser acceptance,
hosted AI accuracy, real same-part photographs and physical iPad behavior remain
separate checks. This change uses existing JSON persistence; it adds no hosted
migration, provider/model change or external vehicle lookup service.

The existing [Google generate-content request contract](https://aistudio.google.com/api-reference/generate-content)
was checked on 2026-11-05; the endpoint and model configuration are unchanged.
