# Phase 8: Supabase Cloud Sync Validation

Phase 8 is not "add Supabase code and hope." It is only done when a real Supabase project can pass an end-to-end sync check.

## Parent-Required Setup

A parent should help with the Supabase account, project ownership, and privacy terms before real users upload scan photos.

In Supabase:

1. Create a project.
2. Apply `supabase/migrations/20260518000100_deepspec_secure_foundation.sql`.
3. Enable anonymous sign-ins in Auth if you want device-only users.
4. Confirm the `scan-images` storage bucket is private.
5. Copy the project URL and publishable/anon key.

In `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
```

Do not put a service-role key in `.env.local`, especially not in a `VITE_` variable.

## Verification Command

Run:

```bash
npm run verify:supabase
```

The verifier must:

1. Check that anonymous sign-ins are enabled.
1. Sign in as an anonymous Supabase user.
2. Upload a tiny private test image to `scan-images`.
3. Upsert a test row in `public.scan_lookups`.
4. Read the row back as the owner.
5. Sign in as a second anonymous user and prove that user cannot read the first user's row.
6. Download the private image as the owner.
7. Delete the test row and test image.

If any step fails, Phase 8 is not complete yet. Fix the Supabase config, migration, bucket, Auth setting, or RLS policy, then run the verifier again.

## If Anonymous Sign-In Returns A Database Error

If `npm run verify:supabase` says `Database error creating anonymous user`, the app reached Supabase Auth but Supabase failed while inserting the anonymous user.
The verifier now confirms `external.anonymous_users` before sign-in, so a failure after that preflight is not a React/browser bug and is not fixed by changing the publishable key.

Check this before changing app code:

1. Supabase Dashboard -> Authentication -> Sign In / Providers -> Anonymous sign-ins is enabled.
2. Supabase Dashboard -> Auth logs: open the failed `/signup` event and read the database error. The verifier prints the project-specific Auth logs link when it can derive the project ref from `VITE_SUPABASE_URL`. It also prints the raw `/signup` `sb-request-id`, `error_id`, and `x-sb-error-code` when Supabase returns them.
3. Run `npm run supabase:print-auth-diagnostics`, paste the printed read-only SQL into Supabase SQL Editor, and inspect every result set.
4. If SQL shows non-internal triggers on `auth.users`, inspect the matching function body, `security_type`, owner, and `function_config`. A trigger function writing to `public.profiles` or `public.users` must be `security definer` and should pin `search_path`.
5. If SQL shows `public.profiles` / `public.users` constraints, make sure they allow anonymous users or remove the trigger that writes to them. Do not run the generated drop-trigger statements until the Auth log or function body proves that trigger is the failing object.
6. If diagnostics show the standard Supabase template path `auth.users -> public.handle_new_user() -> public.profiles`, run `npm run supabase:print-auth-anonymous-repair`, review the printed SQL, then paste it into Supabase SQL Editor. This repair does not drop triggers; it makes `public.handle_new_user()` return immediately for anonymous users so profile-row constraints cannot block DeepSpec cloud-sync auth.
7. If you have a privileged Postgres connection and the diagnostics confirmed that exact standard trigger path, you can apply the same repair without putting the database password on the command line:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
npm run supabase:apply-auth-anonymous-repair -- --confirm-standard-profile-trigger
```

The apply command refuses to run without `--confirm-standard-profile-trigger`, uses `psql` over stdin, and maps the connection string into `PG*` environment variables so the URL is not passed as a process argument.

8. Apply this repo's migration if it has not been applied yet.
9. Rerun `npm run verify:supabase`.

## GitHub Actions

The GitHub CI workflow runs `npm run check` on pushes and pull requests. It also runs `npm run verify:supabase` when these repository secrets are configured:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

If those secrets are missing, ordinary feature PRs record an explicit "not verified" warning in the GitHub step summary. `main`, `codex/production-readiness-release*`, and `codex/release-v*` branches fail instead, because those branches must prove Supabase cloud sync before they can be called release-ready.

Do not start Phase 9 until anonymous sign-in can create a user and the verifier passes.

## If scan_lookups Is Missing From The Schema Cache

If the verifier says `Could not find the table 'public.scan_lookups' in the schema cache`, the DeepSpec migration has not been applied to that Supabase project, the `public` schema is not exposed to the Data API, or the Data API schema cache has not refreshed yet.

Fix:

1. Open Supabase Dashboard -> SQL Editor.
2. Run `npm run supabase:print-migration`.
3. Paste the printed SQL into the Supabase SQL Editor and run it.
4. Go to Project Settings -> API and make sure the `public` schema is exposed.
5. Wait a minute. The migration also sends `notify pgrst, 'reload schema';` to ask the Data API to refresh.
6. Rerun `npm run verify:supabase`.

## Phone Acceptance Test

After the command passes:

1. Run `npm run dev`.
2. Open the app on a phone through HTTPS.
3. Scan a harmless car part.
4. Open the saved result.
5. Tap `Sync this scan`.
6. Verify Supabase Storage has the uploaded image under the authenticated user's folder.
7. Verify `public.scan_lookups` has the scan row with category, training label/status, rating, correction, notes, and result JSON.

Do not move to a dataset review dashboard until this passes.
