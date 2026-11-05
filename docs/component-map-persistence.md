# Component-map persistence

A map belongs to one owner and one overview scan. Its ID is the overview lookup ID. The overview photo ID is immutable: each component's optional box names that exact source photo. Component UUIDs and link UUIDs survive renaming, review and reopening. The map supports up to 100 components independently of segmentation masks; each linked scan group still contains one to four original photo IDs.

`needs_view`, `inspected` and `not_visible` are explicit human review states. AI output and a successful scan save do not mark a component inspected. Reviewed states carry a human review timestamp. Notes and links remain separate from AI conclusions.

## Device record and concurrency

`src/services/componentMapStore.ts` keeps the canonical map in owner-scoped IndexedDB records. The map is not duplicated as mutable JSON in `Lookup` or localStorage. Its record contains the document, local revision, last observed cloud revision, last synchronized local revision, and optional sync-attempt/conflict metadata.

Edits compare the exact local revision inside an IndexedDB read/write transaction. Another tab's committed edit causes a visible stale-revision error; the stale document never silently wins. A sync acknowledgement rereads the record transactionally, checks its attempt ID and observed cloud revision, and preserves any newer device edits. Only the sent local revision is acknowledged. Account generation checks prevent delayed work from updating a newly selected account.

## Cloud contract

`public.component_maps` has primary key `(user_id, map_id)`, a JSON document, and an independent optimistic revision. SELECT, INSERT, UPDATE and DELETE are owner-only. Shop access to an underlying scan does not grant access to its map or make that scan another user's owned overview. The security-invoker trigger fixes `search_path`, validates the complete document, enforces immutable identity/original photo and next revisions, and verifies that linked scan/photo IDs belong to the same owner.

Without a confirmed cloud revision the client uses INSERT only. Otherwise it updates with owner, map ID and observed revision predicates, setting the next revision. It never uses an unconditional UPSERT. A revision conflict stores the fetched cloud document alongside the unchanged device document and advances the local revision so an older conflict screen cannot resolve a newer conflict unseen. No timestamps choose a winner.

`loadComponentMapFromCloud` imports only when no local map exists, including a second check inside the transaction. `syncComponentMapToCloud` verifies each referenced original photo group through the normal authorized scan path; a missing cloud scan is uploaded before its map, when its complete evidence is available locally. Missing scans/photos, storage failures and missing migrations block map sync with an explicit message. They do not remove components or links.

`resolveComponentMapCloudConflict` requires the exact displayed local revision and an explicit device/cloud choice. Keeping the device version adopts only the reviewed cloud revision as the next compare-and-swap base. Choosing the cloud version imports the reviewed document. Neither choice automatically writes to the cloud. The UI retains a restorable device draft when the user chooses the cloud version.

Cloud map requests have a 20-second abort/response deadline. A two-minute durable attempt claim prevents concurrent tab saves during a normal request; after a crash it may be retried. An expired or late request still cannot overwrite a newer cloud revision, and its acknowledgement cannot clear another attempt. A lost acknowledgement is reported as uncertain, not success; retrying may expose a conflict for explicit review.

The overview foreign key uses RESTRICT: deleting the cloud overview while its map exists fails and preserves the accumulated map. Remove or export/reconcile the map before deleting that overview through an authorized administrative workflow; this slice does not add a map-delete UI. Deleting a detail scan leaves the map link intact and visibly unavailable. Another map save cannot claim that missing evidence was synchronized.

## Capture linking

The persisted photo draft includes its map ID, component ID, link-attempt UUID and preallocated lookup ID. Capture resume uses that saved target, never the currently selected component. The device lookup save and map-link transaction use separate storage systems: they are not presented as one atomic write. The matching draft must remain until the idempotent link is committed, allowing recovery by the preallocated lookup ID after an interruption. Replacing or retiring a draft compares both photo evidence and target, preventing a different draft from being retargeted or erased.

## Migration and verification

Migration: `20261105091323_component_maps.sql`, generated with the installed Supabase CLI 3.0.0 `migration new` command. It is prepared locally and must be approved/applied before deployment of cloud-map functionality. No hosted schema or credentials were changed while preparing this feature.

Disposable PGlite verification covers owner isolation despite shared scan visibility, malformed documents, IDs/geometry, independent revisions, stale writes, overview deletion protection and retained unavailable detail links. Client tests cover local edits during upload, conflict preservation and explicit resolution, account changes, missing evidence, missing migration, late acknowledgements, bounded requests and cloud-import races. Full project CI and real authenticated browser/cloud acceptance remain separate release checks.

Supabase guidance checked on 2026-11-05: [owner-scoped RLS and UPDATE policies](https://supabase.com/docs/guides/database/postgres/row-level-security), [filtered updates](https://supabase.com/docs/reference/javascript/update), and the [CLI v3 local/hosted targeting change](https://supabase.com/changelog/supabase-cli-v3). The [November 10 TLS cipher change](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) does not require a schema change; supported modern browsers are expected for live acceptance.
