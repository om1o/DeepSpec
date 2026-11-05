# Inspection selection integrity

When a photo has no selection geometry, review starts on the unannotated Original. No default rectangle, part name or unattached cutout is presented as a located part. An explicit correction can open an editable draft; it does not change the AI answer. Existing approximate issue annotations remain available through Outline.

For scene isolation, every valid attempted selection (up to four) is retained. Disabled or unavailable segmentation, load/inference failure, timeouts and partial mask failure produce an explicitly labeled crop of the original. A successful primary cutout is retained if the later scene pass fails. Mixed scenes show cutout/crop counts; approximate boxes are not verified component contours. Cached results retain available scene selections without another model request.

Selecting or correcting an object does not request another analysis. The separate **Analyze selected area** action uses the normal authenticated identify flow and scan allowance. Its answer remains in the current Scanner view; it is not yet a durable independent inspection.

Area editors freeze the photo/selection callback and target they opened against. A save checks that original photos, photo IDs/order, analysis attempt and selection metadata still match the latest stored record. Changed objects, replaced photos and deleted device scans reject stale edits. Saving an initially unsaved scan while its editor is open must not create a duplicate on Apply. Unrelated notes are preserved. This is a stale-state check around existing synchronous local storage, not a cross-tab database transaction.

Renewing a signed link to the same owned, untransformed Supabase object may be accepted under the configured project and account/scan path. Different assets, external URLs and transformed image URLs remain distinct. This check neither authenticates a token nor proves remote image bytes are unchanged.

## Verification and limits

Regression coverage includes mask/crop mixtures, missing geometry, original view, editor target replacement, storage replacement/deletion and explicit analysis initiation. Native acceptance should save, reopen and export a mixed scene; verify exact original image bytes; correct a secondary object; and reject an edit after replacing or reordering its saved source.

The source still requires a primary selection box to attempt the multi-object scene pass. These selections belong to the first photo only. Secondary-photo region editing, durable per-claim annotations, confidence calibration and physical iPad/Safari acceptance remain unfinished. Synthetic UI tests do not establish segmentation accuracy, mechanical condition, live Gemini compatibility or usefulness on an actual vehicle.

Automatic Vercel deployment is disabled for this branch. Credentials, migrations, deployment and Production promotion are outside this source change.

## References

- [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API): local storage is shared by same-origin documents and its operations are synchronous. This patch does not claim transactional protection across tabs.
- [Supabase signed URLs](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl): signed access expires and can be renewed for a stored object.
- [Supabase image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations): transformation options affect image content; transformed URLs are not treated as unchanged originals.

No third-party code, model weights or automotive images were added for this change.
