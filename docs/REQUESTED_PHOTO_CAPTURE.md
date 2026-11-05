# Collecting requested photographic evidence

The condition result can already ask for a photo, a visible marking, a measurement, or professional inspection. The requested-photo flow connects validated photo/marking advice to the existing follow-up capture so the owner can see the exact request and its purpose while collecting new evidence. Measurements and professional inspection remain distinct actions.

## Owner flow

1. Open a saved result and choose **Collect requested photo** (or **Collect requested marking photo**) beside its priority next evidence.
2. Select a reference original. A single cited photo can be preselected; several cited photos, or a request without citations, require an explicit choice. The reference is not a generated isolation and is not included among new photos.
3. Capture or upload one to four new photos, label them, and explicitly declare their relationship. The exact request and why remain visible. Keep the draft and reopen it if interrupted.
4. Press **Analyze** to start analysis of the new photos. Starting capture, selecting the reference, uploading, or reopening a draft does not itself request AI analysis.
5. Review the new saved inspection and its dated reference. The initial comparison keeps vehicle/component identity unconfirmed and its outcome unreviewed. Collecting a photo does not establish that the earlier uncertainty has been resolved.

## Evidence and recovery boundaries

Requested capture uses a version-2 comparison target and a version-8 photo draft. Older clients reject this draft version instead of silently discarding its instructions. The target carries the exact validated request, purpose, cited IDs, originating analysis attempt when recorded, an analysis fingerprint, a verified earlier original, and reserved destination IDs. Existing unguided dated captures retain their earlier format.

The origin must already be saved on this device. The entry action checks the current saved source and result during preparation. Newly captured photos are saved even when the earlier source may subsequently have changed; a pending draft records an intended task, not a verification result. Explicit analysis and completion recheck the origin. A changed origin blocks the operation and retains the new photos for review. Final draft retirement compares the full observed envelope, including its guide, and checks the issued source guard within the storage callback. A newer draft is preserved.

The guide is capture/recovery context. It does not change the provider prompt or the saved comparison/report schema. The follow-up model receives the new photographs; the earlier reference and guide are not automatically passed as a comparison question. The earlier result and human inspection notes remain separate. No label claims that the AI has answered the prior question.

IndexedDB draft writes and localStorage scan records are separate stores. Guards detect observed changes; they do not provide a global transaction across browser storage or cloud services. Browser data can still be removed by device settings. This source change does not establish Safari/iPad camera reliability, live-provider behavior, or usefulness on real vehicles.

## Source-informed implementation

Reviewed 2026-11-05. These are design references, not copied code:

- [React: Preserving and resetting state](https://react.dev/learn/preserving-and-resetting-state): component identity and keys determine state lifetime. A changed source/request must not inherit an earlier reference-selection operation or navigate after its cancellation.
- [W3C IndexedDB: Transaction lifecycle](https://w3c.github.io/IndexedDB/#transaction-lifecycle): a request callback temporarily makes its transaction active, and an inactive transaction can commit once requests finish. Complete asynchronous verification first; use the existing synchronous final mutation guard inside the callback. Do not keep a transaction alive while hashing images or awaiting network work.

These references inform implementation boundaries only. Regression tests and native-browser observations must establish the implemented behavior, and real-device/user trials remain separate release requirements.
