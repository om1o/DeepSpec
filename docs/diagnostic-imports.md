# Diagnostic text evidence

This slice imports an immutable plain-text file alongside a saved scan. It does not connect to a vehicle, clear codes, reproduce a vendor code catalogue, or infer a failed component from a code. A human association to a photograph remains separate from the scanner's observations and the AI result.

The initial parser, `vcds-autoscan-text-v1`, recognises English VCDS Auto-Scan text. Its source evidence is the public 22.4.0.1 example linked in [Ross-Tech's Auto-Scan manual](https://www.ross-tech.com/vcds/tour/autoscan.php). This is an observed format, not a vendor-promised schema. Other versions receive an explicit compatibility warning and incomplete coverage. The parser does not claim support for the current VCDS release, every vehicle, translated reports, individual-controller reports, PDF, HTML, OBDLink or Car Scanner exports.

## Original and derived evidence

`DiagnosticDocument` stores the exact original bytes as canonical base64, their SHA-256, selected encoding, file metadata, import time and saved lookup ID. Synchronous normalization validates metadata, a real UTC import date, UUID, scan ID, base64 round-trip and decoded length. Verification independently recomputes SHA-256 before deriving parsed fields; a mismatch is an error. The hash detects changes against the saved document, not authenticity of the source or truth of the measurements.

UTF-8 decoding is strict. An invalid sequence asks the user to choose Windows-1252 explicitly; there is no automatic encoding guess or transcoding of the original. Both documented vendor examples fail strict UTF-8 and contain byte `B0` for the degree sign. They are Windows-1252-compatible, but their bytes and charset-free HTTP headers do not distinguish Windows-1252 from ISO-8859-1. UTF-8 BOM and line-ending bytes remain in the original download even though parsing strips a leading BOM and recognises CRLF, LF and CR lines.

Files must have a `.txt` extension (case-insensitive) and an empty MIME, `text/plain` or `application/octet-stream`. Other extensions are rejected rather than silently renamed, so original downloads cannot acquire an active HTML extension. Binary control characters are rejected. Unknown textual formats and incomplete scans may be retained as originals with explicit coverage. The importer does not execute markup or scripts, load remote content or send evidence to a provider.

## Parsing contract and limits

The parser preserves controller order and addresses, declared fault counts, explicit no-fault statements, vendor codes as opaque strings, optional generic codes, exact status/detail lines, readiness text and ordered freeze-frame readings. Duplicate generic codes, addresses and reading labels remain separate. Unlabelled readings remain readings with an empty label. Source-line IDs are stable for one original (`controller-12`, `fault-18`, `frame-21`, `reading-22`); associations must also identify their document. No missing status or unit is inferred. Report timestamps remain raw local values, without an invented timezone.

Controller identifiers and other unprojected source metadata remain in the immutable original. Private plate/order/workshop values are not extracted into the structured projection. The reported VIN is distinct and should remain controlled by report sharing preferences. The original download itself may contain all private source fields; it is not a redacted export.

Coverage describes interpretation of this file, never vehicle health. Missing/malformed terminators, conflicting or mismatched fault counts, absent controller statements, unexpected content and inventory sections without controller data produce incomplete coverage. A single-controller report has a different structure and is unrecognised. Unknown or unparsed material remains in the source. [Ross-Tech's fault-code documentation](https://www.ross-tech.com/vcds/tour/dtc_screen.php) notes that some controllers do not know the correct date/time; freeze-frame dates are preserved as reported values, not verified chronology.

Hard limits are implementation choices: 2 MiB original bytes; 20,000 lines; 4,096 characters per line; 256 controllers; 2,000 parsed faults; 512 readings per freeze frame; 256 detail lines per fault. The global line limit also bounds frame and reading totals. A limit violation throws an actionable error; no truncated successful result is returned. Verification repeats parsing limits on restored documents. Source storage and cross-document aggregate limits belong to the evidence store.

## Provenance and rights

Research checked these original examples in memory; they are not bundled in this repository:

- [22.4.0.1 Auto-Scan](https://www.ross-tech.com/vcds/tour/saved/Scan-WVW487CD4NW186292-20220610-1101-175km-108mi-2.txt): 31,153 bytes; SHA-256 `0a9861174c0e41aea67ca8c6b83b418eb4a6b8bc90f0ead9f07f686a4ca28c78`; 32 controller sections, 18 faults and freeze frames.
- [17.8.0.1 individual-controller report](https://www.ross-tech.com/vcds/tour/screenshots/Log-2SMOKY4U-9BWFR61J044030906-176420-2112.txt): 3,901 bytes; SHA-256 `dab4be9f6d1dd045f3779fa06ce482d777212df02fd385047fbab550cce3c959`; eight faults and freeze frames. This is an unsupported report kind, useful for verifying that the recognizer does not mislabel it.

Implementation is original code based on these documented structural observations. Tests are explicitly synthetic; they do not copy vendor reports or proprietary descriptions. The [vendor terms](https://store.ross-tech.com/store-terms-and-conditions/) restrict software reverse engineering, redistribution and certain reference uses, and the manuals reserve copyright. No express report-parser integration licence or sample redistribution permission was found. This is not a vendor-approved integration or a legal conclusion about independent text imports. Commercial permission remains unconfirmed. No vendor software, protocol, ROD/label database or definition catalogue is included.

Current-release support requires additional genuine reports with the relevant app version, locale and permission for testing. An actual current Auto-Scan with faults/freeze frames and a no-fault report would expand evidence; the old examples alone do not establish that support.

## Saving and sharing

Device storage is scoped to the active account and saved scan. Immutable originals and human associations are verified outside IndexedDB transactions, then compared against the exact bucket in a fresh transaction before use or append. Concurrent additions are merged; conflicting immutable IDs are rejected. Correction alternatives imported from another device remain visible. Drafts use compare-and-swap on the exact stored text, and already-entered queued edits can finish after navigation only while their original account remains active.

Cloud synchronization is explicit and requires a verified non-anonymous owner session. It verifies original hashes and parsed entry references before importing, inserts documents before dependent associations and corrections, and confirms immutable acknowledgements. The migration grants owner SELECT/INSERT, retains reports when a source scan is removed, and limits each scan to 8 documents, 100 associations and 24 MiB of stored JSON. SQL enforces canonical bytes/hash, ownership, reference shape and storage bounds; exact decoding, parser limits and entry membership remain mandatory client verification. A hash proves consistency against saved bytes, not that scanner readings are authentic.

The mechanic handoff includes ordered extracted readings, source-line references, human associations and retained corrections. Exact photo/context verification controls whether a historical association can link to an embedded current photo. Missing or changed originals are identified without substituting another image. A final joint transaction checks the map, service records, comparisons and diagnostic bucket before the snapshot is returned.

Original diagnostic files and filenames are excluded by default. Including them is a separate explicit choice, with a warning that they are unredacted even when saved VIN fields are excluded. Downloads preserve original bytes and use a `.txt` filename. Extracted text and human notes can still contain identifiers and must be reviewed before sharing.

On 2026-11-05 the actual parser was executed against both vendor examples in memory. The Auto-Scan produced 32 controllers, 18 faults, 18 freeze frames and 163 ordered readings with no parser warnings and exact-byte preservation. Strict UTF-8 failed as expected; explicit Windows-1252 succeeded. The individual-controller example remained unrecognized with its original preserved. No raw vendor examples are included in the source or test fixtures. These checks do not establish live deployment, current-version support, physical-device behavior or diagnostic accuracy.
