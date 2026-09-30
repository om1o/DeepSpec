# DeepSpec continuation — September 20, 2026

## Scope

Resume the no-camera bug sweep. Preserve and verify the prior session's pending
fixes for share cancellation, local history cap, duplicate chat context, viewport
changes, offline scan caching, blocked-camera upload feedback and file types,
post-login redirects, concurrent credit accounting, webhook signatures,
background login sync, duplicate waitlist signup, and malformed optional AI fields.

## Additional fix

An object-analysis request from a closed or replaced scan could overwrite the
next scan's card at the same object index. Completion handlers now check that
their captured analysis session is still current before applying success or error.

The Scanner regression test opens two synthetic multi-object scans and settles
the first scan's pending response after the second scan has a result. Both success
and failure cases failed before the fix; all 34 Scanner tests passed afterward.
Independent review confirmed that scan start and review close invalidate the
captured session. No real camera or provider calls are required for these tests.

## Remaining work and limits

- Live-device queue carried forward: Bug B, Bug C, seven-case harness rerun,
  live SAM verification, first camera-switch behavior, rotation/URL-bar card
  positioning, and denied-camera upload layout/HEIC conversion.
- The stale object-response race is now covered synthetically; visual SAM quality
  still requires the live-device checks above.
- Credit consumption retries optimistic updates four times. It does not atomically
  reserve quota before provider calls; high contention can exhaust retries.
- Legacy Polar-secret compatibility in the readiness/replay scripts remains to
  be aligned with the API. No live billing integration was exercised here.
- Offline cold-start authentication remains fail-closed by existing design.
- No live website QA or production-readiness claim is made by this continuation.

## Verification

- `npm run lint`: passed.
- `npm test -- src api --reporter=verbose`: 50 files, 651 tests passed.
- `npm test -- scripts --reporter=verbose`: 16 files, 91 tests passed.
- Total: all 66 test files and 742 tests passed.
- `npm run build`: TypeScript and production build passed; large-chunk warning remains.
- `git diff --check`: passed.
- The initial combined `npm run check` stalled without test results and was stopped.
  The split runs above cover every test file in the repository.
- Local logs: `artifacts/qa/2026-09-20-continuation/` (ignored by Git).
