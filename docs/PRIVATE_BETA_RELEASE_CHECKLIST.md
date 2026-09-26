# DeepSpec private-beta release checklist

Prepared September 26, 2026. Scope: one seller, one operator, one part family,
supervised and unpaid. This is a review packet, not deployment approval.
Production SQL, repository settings, deployment and main-branch merge were not
changed while preparing it. Paid launch has additional gates in
[DAD_PHONE_PAID_BETA_RELEASE.md](DAD_PHONE_PAID_BETA_RELEASE.md).

## Current evidence and blockers

| Gate | Evidence | Status |
| --- | --- | --- |
| Inspection column | Read-only GET of `scan_lookups?select=inspection_json&limit=0` at September 26, 16:10 UTC returned HTTP 400 / PostgreSQL `42703`: column missing. No login, row, image or schema writes. | Blocked: apply reviewed migration, then verify live persistence. |
| Auth configuration | Same read-only check: Auth settings HTTP 200, signup and anonymous sign-in enabled. | Settings reachable; does not establish password login, email delivery or account recovery. |
| Current published CI | Freshly retrieved [run 36239978729](https://github.com/om1o/DeepSpec/actions/runs/36239978729), head `aa3bced860c1d1af866b3b05c6a0206f73641394`: lint/tests/build succeeded, auth failed because the two Supabase settings were unavailable, cloud check skipped. This is an earlier completed run, not a new run. | Blocked: settings and a successful run on the final review head. |
| Prior browser/local tests | [September 26 work log](SELLER_RELIABILITY_PROGRESS_2026-09-26.md) records 984 tests and mobile/desktop inspection save/reload/export checks. Cloud inspection failures were intercepted. | Historical evidence only; not rerun by this checklist task and not evidence for later draft-recovery changes. |
| Physical device and seller trial | No new physical-phone or seller measurements collected for this checklist. | Pending. |

Source reviewed: the existing migration, `.github/workflows/ci.yml`, auth/cloud
verifiers and [pilot protocol](PILOT_RUNBOOK.md). Any later code publication
must record its own commit and checks; the head above is a baseline.

## 1. Review and apply the inspection migration

Owner/developer action after review:

1. Confirm the intended Supabase project matches the app's configured project.
   Use the existing deployment process and retain the migration execution
   record. Test against the intended non-production environment first when
   available. Do not apply the output of `supabase:print-migration` for this
   single change: that helper prints every migration.
2. Review exactly
   [20260920000100_part_inspection.sql](../supabase/migrations/20260920000100_part_inspection.sql).
   It adds a nullable JSONB object column and a comment; it does not change
   ownership policies or existing inspection values. The SQL is:

   ```sql
   alter table public.scan_lookups
     add column if not exists inspection_json jsonb
       check (inspection_json is null or jsonb_typeof(inspection_json) = 'object');

   comment on column public.scan_lookups.inspection_json is
     'Optional human inspection: identity evidence, visible condition, functional test, reviewer and time. Not an AI label, verified certification, or training consent.';
   ```

3. If this project uses Dashboard-managed SQL, open that project's SQL Editor,
   review this exact SQL and execute it once. If migrations are CLI-managed,
   apply this file through that migration workflow after reviewing its pending
   list; do not blindly push unrelated pending migrations. Reconcile any direct
   Dashboard change with the existing migration history. Supabase describes
   [versioned migration deployment](https://supabase.com/docs/guides/local-development/database-migrations)
   and [Dashboard SQL](https://supabase.com/docs/guides/database/overview).
4. Read back the column definition in SQL Editor:

   ```sql
   select column_name, data_type, is_nullable
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'scan_lookups'
     and column_name = 'inspection_json';
   ```

   Expect one row: `inspection_json`, `jsonb`, `YES`. If the column already
   existed, `IF NOT EXISTS` does not prove its type or constraint is correct;
   inspect the table definition instead of assuming the migration repaired it.
5. With the intended project's public settings in the ignored local env file,
   run `npm run verify:supabase -- --inspection`. Save the complete log in
   `artifacts/qa/` with its date and tested commit. Require exit 0, exact
   inspection save/read/update, preserved scan evidence, second-account
   read/write denial and verified fixture cleanup.

The verifier creates isolated anonymous accounts and synthetic rows/images,
then checks removal of those generated rows/images. The anonymous auth accounts
remain because public credentials cannot remove them. It never deploys SQL.
Its success is a required **additional** check: current CI runs ordinary
`verify:supabase` without `--inspection`. A green CI run alone does not prove
inspection cloud persistence. Leave the additive column in place if the app
must be rolled back; do not drop inspection data to undo a frontend release.

## 2. Configure the existing GitHub Actions gates

Owner/repository administrator action after review:

1. Obtain the project URL and publishable/legacy anon key from the same
   intended Supabase project. The Dashboard's Connect dialog and Settings →
   API Keys provide these settings. Never substitute a secret/service-role
   key; those have elevated privileges.
   [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
2. Open [DeepSpec Actions secrets](https://github.com/om1o/DeepSpec/settings/secrets/actions).
   Under **Settings → Secrets and variables → Actions → Secrets**, add or
   update these **repository secrets**, preserving their exact names:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Intended project's URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Same project's publishable/legacy anon key |

   These names are consumed through `secrets`, not repository `vars`.
   The current workflow has no environment binding, so an environment-only
   secret is not a replacement. Keep values out of source, PR text and logs.
   [GitHub repository-secret instructions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
3. On [PR #114](https://github.com/om1o/DeepSpec/pull/114), rerun the failed CI
   job after settings are configured, or run CI for the final review branch.
   Record the actual tested head and run URL. Require success of quality,
   auth-provider and ordinary cloud-sync steps; warnings or skipped steps do
   not count. Do not remove the existing main/PR-to-main failure gate.
4. Record actual password and email-code sign-in/recovery on the intended
   tester account separately. `verify:auth` skips those paths when credentials
   are missing, so its exit 0 can mean settings-only coverage. The existing
   workflow accepts `DEEPSPEC_AUTH_TEST_EMAIL` and
   `DEEPSPEC_AUTH_TEST_PASSWORD` for a dedicated tester account. Treat the
   one-time `DEEPSPEC_AUTH_TEST_EMAIL_CODE` as a short-lived manual check,
   not a reusable CI password. Do not enable code sending automatically.

Repository secrets configure CI only. Deployment environment settings and the
preview URL must be reviewed separately; this checklist does not publish a site.

## 3. Prove the final build on the intended phone

Record the HTTPS preview URL, commit, device/browser and evidence folder.
Use fictional notes and a reusable tester account for multi-device checks.

- [ ] Run `npm run check` on the final source. Run the repo's doctor-first
  `npm run test:website -- --url <preview-url> --headless --viewport phone`.
  Preserve the report; distinguish test/environment failures from product bugs.
- [ ] On the physical phone, capture/upload a part, review its uncertain AI
  suggestion, save a human inspection, reload and compare all eight fields.
  Sign out/in, reopen, export and compare the downloaded report. Verify cloud
  readback on a second device before calling the inspection backed up.
- [ ] Type an incomplete inspection, refresh and close/reopen the page.
  Explicit restore must recover the exact draft; discard must remove that
  recovery copy. Neither action may silently replace a newer saved inspection.
- [ ] Disconnect the network and edit, then reconnect before reloading. A fresh
  offline app load is not promised by draft recovery. Device draft/device save
  wording must stay distinct from cloud success. Use the explicit save
  or retry, then prove cloud readback. Storage failure must leave typed notes
  available with a clear warning and a working draft download.
- [ ] Switch accounts: the other account must not see or restore these drafts
  or inspections. In two tabs, save a newer inspection and attempt an older
  form/draft: reject silent overwrite and retain an export/review route.
- [ ] Compare actual downloads and confirm fields/buttons remain usable while
  scrolling. Mobile emulation alone does not prove phone camera/storage or
  operating-system interruption behavior.

The draft checks above are release acceptance criteria, not claims that an
implementation has passed. Keep the trial to one editor: the current cloud
model lacks atomic conflict protection across devices. Browser storage can be
cleared; a device draft is not a cloud backup, functional test or certification.

## 4. One-seller trial: go / stop / continue

Use [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md) and its empty observation template.

**Go:** all applicable gates above pass on the exact trial build; one seller
approves photo storage and required fields; one operator selects one part
family. Rehearse first, then log ten manual baseline observations, followed by
one balanced twenty-part comparison batch (ten manual, ten DeepSpec). Use
distinct physical parts and retain failed, abandoned and unresolved attempts.
Functional checks remain unchanged. Log onboarding/support effort separately.

**Stop:** any lost inspection, cross-account exposure or unsupported identity
accepted for external use. Retain the failed observation, investigate and
retest before restarting. If inspection-cloud verification is blocked, allow
only a clearly labeled local rehearsal, not a successful cloud-backed trial.

**Continue:** review completion rates, identity errors, missing timing and
support effort alongside time. The proposed target is at least 30% lower
median active time with no increase in wrong accepted identities, no lost
records and no missing-timing shortcut. This is a feasibility target for a tiny
sample, not a proven business outcome. Ask the seller for yes/no/not-yet on
continuing and record scope, quoted price and reasons. No time savings,
willingness to pay or pricing has yet been established by this checklist.
