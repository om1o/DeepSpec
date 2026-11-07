# Requested measurements

When a saved condition finding asks for a measurement, **Record requested measurement** opens the existing human service form. The action does not obtain a measurement, call a model, prescribe a procedure, or decide whether a vehicle is safe.

The form retains the exact saved request, its purpose, cited original photo IDs, originating analysis attempt when available, and a SHA-256 fingerprint of the full saved answer. Each cited original is bound to its decoded dimensions, file-byte hash, and saved context. A request without photo citations retains an empty reference list; an arbitrary photo is never substituted. An explicit empty photo group is never treated as a legacy single-photo scan.

Quantity, reading and unit remain human input. A reading is stored as its exact numeric text (for example, `12.500`); no rounding, unit conversion or threshold is inferred. “No reading obtained” retains the reason. Saving either outcome does not resolve the AI request or change inspection status.

## Drafts and corrections

An existing unfinished draft must be restored or explicitly discarded before a requested measurement can take its place. Draft persistence uses account-scoped IndexedDB compare-and-swap writes. Source verification runs before the initial requested draft and before saving a new measurement; a synchronous source guard runs inside the final write transaction. Failed verification or storage leaves the entered text available for recovery.

New measurements require the current saved answer and every cited original to match the receipt. Corrections and retractions preserve the original receipt and immutable parent link. They can be recorded after the AI answer changes or historical evidence becomes unavailable; retaining a receipt is not a fresh verification of that evidence. The report independently checks the originals it actually embeds and displays changed, missing or unverified references explicitly.

## Compatibility and cloud

Ordinary human service records and drafts remain version 1. Requested measurements and their corrections/retractions use version 2 with a required receipt. A version 1 payload cannot carry version 2 metadata, and an existing history entry cannot be silently upgraded or downgraded by a correction. Older readers reject version 2 rather than presenting it as an ordinary unlinked measurement.

Explicit cloud synchronization transports the complete immutable version 2 record. An older database constraint rejects it; the client retains the device record and reports that a migration is needed. There is no retry with stripped metadata. The accompanying migration is prepared source, not evidence that a shared database was upgraded.

## Evidence limits

The mechanic report distinguishes the AI request, human reading, and photo-reference verification. A matching image hash proves which saved file was referenced, not measurement accuracy, vehicle identity, physical condition, or repair success. Default HTML privacy settings continue to omit recorder names, VIN and private context notes.

Synthetic local UI, transaction, schema and export checks validate this workflow. Live provider access, hosted authentication, cloud deployment, physical iPad capture, real car diagnosis and mechanic usefulness require separate acceptance evidence.
