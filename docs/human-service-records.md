# Human service records

Service history is separate from AI identification, AI dimensions and the existing single `PartInspection` summary. Entries record what a person supplied; they do not establish professional credentials, calibration, repair quality, diagnostic cause or safety. A completed repair never automatically resolves a complaint, clears a safety action or marks a functional test passed. Follow-up is a separate dated entry.

## Model and validation

`src/lib/serviceRecord.ts` exports:

- `normalizeServiceRecord(value)` validates one entry and returns a fresh allowlisted record or `undefined`.
- `serviceRecordValidationError(value)` returns the corresponding field error or `null`. Reference membership requires the complete history, not just this single-record check.
- `normalizeServiceRecords(value, lookupId)` validates a complete history, including references, and returns a stable sorted array or `undefined`.
- `mergeServiceRecords(local, incoming, lookupId)` merges immutable entries, accepts exact canonical same-ID retries, and throws on conflicts or invalid history. Incoming entries may be deltas whose referenced parents exist locally.
- `serviceRecordStatus(record, all)` returns `current`, `superseded`, `retracted` or `conflicting_correction` for already validated records.
- `serviceRecordRows(record, options)` returns plain-text label/value rows for UI and report. HTML callers must still escape every value.

Entry IDs and references to other service entries are UUIDs canonicalized to lowercase. Saved scan, photo and analysis-attempt IDs use the existing restricted character sets; opaque analysis IDs preserve case and need not be UUIDs. Recorded time is a UTC ISO timestamp with seconds and up to three fractional digits. Performed date is a valid calendar date or explicitly unknown. Text is bounded and preserved without truncation; numeric readings remain strings so supplied decimal precision is retained. Finite decimal notation, including exponents, is accepted; units and a method are required when a reading exists. A missing reading requires an explanation and is never turned into zero. There is no automatic unit conversion, rounding, reference-limit lookup or pass/fail calculation.

The complete history is limited to 100 entries and 256 KiB of UTF-8 JSON. Duplicate IDs within an input history are rejected, even when content matches. An exact retry across merge inputs is idempotent; a changed record with the same ID fails rather than overwriting either version. Ordering uses recorded timestamp, then ID, and does not establish which device's clock is more trustworthy.

Superseding entries must reference an existing entry in the same scan and retain its kind, except for an explicit retraction. A retraction requires a reason and cannot itself be superseded. Follow-up references must also exist in that scan. Both correction and related-entry cycles are rejected. Different corrections of the same prior entry remain visible as a conflict; the newest timestamp does not win. A later retraction of one branch does not silently adjudicate the original conflict. Normal local append behavior can prohibit editing an already superseded entry while cloud import preserves valid forks.

Actual photo membership and saved analysis identity must be checked by the caller against the saved scan. This helper validates their syntax but does not load scans or infer that similar photos show the same vehicle or component. Changing a component label, AI answer or current vehicle profile must not silently rewrite an older entry's subject, evidence or vehicle snapshot.

## Privacy and display

Vehicle snapshots allow only core vehicle facts, mileage/unit, modifications, valid self-reported confirmations and the supplied complaint through the shared vehicle normalizer. Customer, job, plate, technician and private vehicle-note fields are never retained. Record-level notes are shared evidence notes and are always included in the display and report.

Display defaults omit the recorder name and VIN; each has an explicit opt-in. The shared `includePrivateNotes` option does not hide service evidence notes or expose private vehicle notes. Source basis, reported methods, repair work, follow-up conditions, correction reasons and evidence notes remain inspection evidence. Forms must disclose that evidence notes are included in reports. Free text and linked photographs can themselves contain identifiers; field-level exclusion is not photo or prose redaction. Recorder names and claimed source basis remain self-reported, including transcriptions from another person's document.

## Source patterns and limits

The [FTC's Auto Repair Basics](https://consumer.ftc.gov/articles/0211-auto-repair-basics) recommends retaining completed repair documentation describing work, supplied parts and odometer readings. This informs the repair-work and saved vehicle fields; the DeepSpec log is not a substitute for an invoice, estimate, authorization or warranty record. It makes no claim of satisfying any jurisdiction's business requirements.

[NIST's metrological traceability guidance](https://www.nist.gov/metrology/metrological-traceability) distinguishes a supported measurement result from merely naming an instrument or calibration source. Traceability and fitness for purpose require more than a saved number. The log records the reported method, instrument and conditions without manufacturing uncertainty, certification or traceability. Detailed calibration/reference documents can be identified in user-supplied method details without copying licensed procedures or supplying service instructions.

Both sources are documentation patterns, not evidence that a specific vehicle was correctly measured or repaired. No proprietary service specification, repair procedure or diagnostic threshold is included.

## Acceptance coverage

Focused tests cover exact numeric precision and missing readings; strict IDs, calendar dates and bounds; vehicle and export privacy; same-ID retry versus conflict; stable ordering; same-scan references and cycle rejection; preserved correction/retraction chains and imported forks; and complete-list UTF-8 limits. Storage, account switching, cloud conflict handling, actual form behavior and exported browser presentation require their own integration validation.

## Persistence and cloud boundary

The device store uses a separate IndexedDB object store in evidence database version 4. Each append or import reads and merges the current history inside one read/write transaction. A stale opened array is never written over newer entries. Owner-scoped keys and account-generation checks cover asynchronous operations; subscriptions notify open views after committed changes. Removing a device scan copy retains this independent history, as the removal confirmation explains.

Unfinished form drafts are separate, owner-scoped recovery copies in their own IndexedDB store. A read/write transaction compares the expected raw draft and commits its replacement or tombstone atomically; two tabs cannot both replace the same prior draft. Autosaves are serialized within the form and marked as kept only after commit. Drafts retain the intended record ID, entered text and frozen photo/vehicle context. Recovery is explicit; concurrent draft edits or changed scan context stop replacement and offer a download. Earlier localStorage recovery text remains available separately and cannot resurrect after a discard. A draft is neither a saved service record nor a cloud backup.

Cloud reads and synchronization require a verified owning account. Synchronization is explicit and requires the scan to exist in the cloud first. It unions immutable entries, uploads referenced entries before their dependants, checks an existing ID for identical content instead of upserting, and confirms the uploaded snapshot by reading it back. A later device append remains local until another sync. Missing schema, access failures and partial network success retain local history and provide retry instructions.

The migration `20261105111736_human_service_records.sql` creates an owner-filtered, insert-only table with a composite foreign key to the owning scan. Authenticated clients receive SELECT and INSERT only. A trigger checks types, bounds and same-scan references, and locks the parent scan while enforcing aggregate limits. Cloud JSONB byte accounting is conservative and can reach the 256 KiB cap earlier than compact device JSON. Deleting the cloud parent cascades its cloud history; it does not delete the independent device copy. Applying the migration and testing real authenticated cloud synchronization are separate release steps.

Disposable PostgreSQL 17.5 validation through PGlite 0.4.6 passed 22 checks of the migration's ownership policies, immutable writes, references, field validation, aggregate limits and cascades. This was a sequential synthetic database, not a hosted or concurrent-session acceptance test. Local native-browser checks also exercised concurrent IndexedDB appends, correction forks, account switching, draft recovery, exact decimal text, linked follow-up entries and preservation through AI retry. The fixture images and entries were synthetic; these checks do not establish automotive diagnostic accuracy or actual iPad reliability.
