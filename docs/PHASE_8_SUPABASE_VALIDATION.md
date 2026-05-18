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

1. Sign in as an anonymous Supabase user.
2. Upload a tiny private test image to `scan-images`.
3. Upsert a test row in `public.scan_lookups`.
4. Read the row back as the owner.
5. Sign in as a second anonymous user and prove that user cannot read the first user's row.
6. Download the private image as the owner.
7. Delete the test row and test image.

If any step fails, Phase 8 is not complete yet. Fix the Supabase config, migration, bucket, Auth setting, or RLS policy, then run the verifier again.

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
