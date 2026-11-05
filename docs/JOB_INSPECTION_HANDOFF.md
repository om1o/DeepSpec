# Job inspection handoff

The shop job page now leads to the existing inspection report with photos. This is an explicit choice of one saved inspection and its linked evidence, not an automatic report of every scan in a job.

## User flow

1. Open a saved shop job. Review its current vehicle details and complaint.
2. In **Inspection handoff**, choose an **Overview inspection**. Nothing is selected by default. The optional `overview` query parameter retains an explicit selection and is checked against the current account and job membership every time it is used.
3. Review the scan's first original, saved date and vehicle facts retained with that scan. Missing facts do not establish a match. Known VIN/year/make/model/engine differences are named without silently replacing saved facts with the current job intake.
4. **Open this inspection** goes to the real Result screen. Browser Back returns to the job URL and chosen overview.
5. Expand **Inspection report with photos**, prepare a fresh snapshot, and review its scope, photos, missing evidence and privacy options before downloading HTML. The existing collector retains maps, linked groups, requested-photo receipts, comparisons, diagnostic evidence and human service history as available. The report states included, excluded, unavailable, conflicting and outside-job scan references; it does not claim complete vehicle inspection.

The selection list reads the current account's device records. It does not search cloud history. A declared scan absent on this device is shown as unavailable; a scan explicitly assigned to a different job is excluded as conflicting. A scan with an explicitly empty photo list cannot fall back to its legacy frame or a cutout. The first actual original is used, with normal image-load failure shown as unavailable; the report collector separately verifies usable image evidence.

Unidentified scans remain usable as evidence. Selection does not run AI or invent a successful model result. Job membership, matching supplied metadata and an AI result are each insufficient to establish the same vehicle or a confirmed diagnosis.

## Editing and freshness

Job and lookup subscriptions refresh membership and notices. State is keyed by account generation and job route. An account change hides the old owner's content and blocks actions. Unreadable storage is an error rather than an empty job or silent redirect.

Background refresh keeps entered VIN/status/notes. If those saved fields changed elsewhere, saving is blocked and the page shows the newer saved values alongside the still-entered form. **Replace form with saved fields** is explicit and changes only the form; copy any entered text first. A deleted or unreadable job keeps the last displayed snapshot and entered text visible to the same account, with actions blocked and a retry control. Unsaved form text is not a durable draft: the page warns users to save or copy it before leaving/reloading.

Save checks current account, job and editable-field baseline immediately before the existing synchronous local write. Read failures and unacknowledged/failed saves do not clear the form. These checks do not turn localStorage into a cross-tab transactional database. The handoff and export use the exact issued job context and recheck it before actions; changing the overview or semantic context invalidates preparation state. A prepared report is a dated snapshot, not a guarantee that no later edits occurred.

## Accurate labels and privacy

The former text-only export is **Quick text summary**. It omits full photos, component maps and detailed evidence history; it may include customer and technician details and must be reviewed before sharing. Its service and format remain unchanged.

The job statistics are **Review activity** and **Marked useful**, not measured accuracy. Feedback counts do not establish diagnosis, fitment, repair success or vehicle safety.

Job handoff coverage exports IDs and differing field names, not additional private job/customer/technician fields. Existing report options govern VIN, private notes and raw diagnostic originals; photos and shared free text can contain identifiers even with optional fields off.

## Validation and limits

Focused source regressions cover explicit selection, valid/invalid retained queries, actual first originals, missing/conflicting membership, saved vehicle differences and unknowns, unidentified evidence, stale click/account guards, job/lookup refresh, deletion/unreadable storage, failed saves, and preserving unsaved fields. Full CI and actual native artifact acceptance are recorded separately; authored tests are not a runtime pass by themselves.

This slice adds no provider calls, credentials, schema migrations, automatic cloud write, new report renderer or hosted deployment. It does not merge independent overview roots into one inspection, establish same-car identity, or prove physical iPad/real-vehicle/mechanic acceptance.
