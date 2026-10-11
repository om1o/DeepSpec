# DeepSpec V1 Preview QA Coordination

Updated: 2026-10-10 (America/New_York)

Release candidate: `codex/v1-preview-20261010` at `99a02756`

The current orchestrator lane ID is unknown. This board records ownership but is not an atomic lock. Workers must still claim overlapping files through the active coordination channel or use isolated worktrees.

| ID | Owner lane | Scope / files | Dependencies | Status | Evidence | Blocker | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-001 | Lane unknown | V1 integration branch and PR #119 | PR #114 base | Complete | 19 scoped commits pushed; PR #119; all review threads resolved | None | Keep branch isolated until all launch gates pass |
| QA-002 | GitHub integration lane | Narrow Vercel SPA fallback, PR #120 | PR #114 base | Superseded and closed | CI rerun green; its `vercel.json` blob matched PR #119 exactly; branch and commit remain preserved | None | Use PR #119 as the single V1 integration path |
| QA-003 | Lane unknown | Full code verification | QA-001 | Complete | 91 test files / 1,256 tests; `npm run lint`; `npm run build` | 550.87 kB model chunk and 23.6 MB WASM are performance debt | Track bundle optimization after launch gate |
| QA-004 | Lane unknown | Vercel route and packaging | QA-001 | Complete locally | SPA rewrite tests and production build pass; Vercel commit status succeeds | Public preview URL was not exposed by the connected status API | Do not promote while QA-006 through QA-009 are open |
| QA-005 | Lane unknown | Production billing/free-credit schema | Supabase access | Complete for preview scope | Migrations `20261010170625` and `20261010170648` present; transactional entitlement tests previously passed and rolled back | Mechanic-shop migration is intentionally outside preview scope | Recheck migration list before promotion |
| QA-006 | External platform owner | Replace exposed legacy Supabase server key | New secret key plus Vercel/Supabase settings access | Blocked | Code accepts `SUPABASE_SECRET_KEY`; opaque-key export regression passes | New key has not been created, installed, verified, and legacy key deactivated | Rotate using the staged runbook in the QA report |
| QA-007 | External platform owner | Auth hardening | Supabase Auth dashboard | Blocked | Security advisor still reports anonymous-auth policy exposure and leaked-password protection disabled | Dashboard settings require authorized human change | Disable anonymous sign-ins and enable leaked-password protection if plan supports it |
| QA-008 | QA worker | Real login, session restore, scan, save, history, reopen | Authorized password or pre-authenticated session; QA-006/QA-007 | Blocked | QA doctor reaches app/Supabase/browser and validates selectors; no credential available | No QA password or reusable verified session in this worktree | User signs in without sharing the password, then rerun `npm run test:website` |
| QA-009 | QA worker | One reliable live identification provider | Approved no-cost provider path or authorization for ordinary provider usage | Blocked | Provider unit/fallback tests pass; no current live completion evidence | No-spending rule; historical production probes failed or rate-limited | Run one approved real scan and preserve provider/model/run evidence |
| QA-010 | Lane unknown | Security advisor classification | QA-005 | Complete | Seven RLS/no-policy tables grant only `service_role`; ownership policies remain scoped | Leaked-password protection and anonymous sign-ins remain open | Do not add broad client policies to server-only tables |
| QA-011 | Lane unknown | Logo and responsive auth rendering | QA-001 | Complete | Blue-slate logo rendered in local browser doctor screenshot; auth selectors and console/network checks pass | Authenticated screens not independently revisited on current head | Cover during QA-008 |
| QA-012 | Orchestrator | Preview promotion decision | QA-006, QA-007, QA-008, QA-009 | Blocked | Vercel and CodeRabbit statuses succeed, but those are not the customer gate | Four launch blockers remain | Promote only after all four close with revision-linked evidence |

## Collision Notes

- PR #119 is the selected V1 integration path. PR #120 was closed as an exact SPA-rewrite duplicate; its branch and commit remain preserved.
- The original dirty checkout remains untouched. All release work was performed in the isolated `v1-preview-release` worktree.
- No production deploy, merge, payment, account creation, password reset, or auth email was performed by this lane.
