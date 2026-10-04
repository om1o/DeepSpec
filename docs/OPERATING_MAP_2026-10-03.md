# Deep Spec Operating Map

Date: October 3, 2026

This map records the current operating lanes from the local repository, local
worktrees, and the live GitHub PR list. It is meant to prevent duplicate work
while Deep Spec has multiple active Codex branches.

## Executive Summary

- `main` is currently at `2843d88c` (`Fix scanner AR overlay accuracy`) and this
  checkout started clean from that commit.
- There are no standalone open GitHub issues returned by the public issues API
  during this pass. The backlog is mostly embedded in documentation and open
  pull requests.
- The live open PR stack is: #104, #105, #108, #109, #112, #113, and #114.
- PR #114 (`codex/mechanic-shop-mode`) is the dominant active lane. It overlaps
  V1 scanning, inspections, consent-controlled review, private diagnostics,
  reports, dataset membership, and launch readiness. Do not absorb it into a
  separate lane casually.
- The highest-risk blockers remain external or cross-lane: production Supabase
  verification, provider reliability/eval completion, stale overlapping PRs,
  and owner-level decisions about billing, launch, privacy, and credentials.
- Safe work from `main` should be branch-neutral: verification, docs, issue
  hygiene, or narrow fixes that do not duplicate PR #114 or the focused release
  branches.

## Operating Lanes

| Lane | Owner or branch evidence | Scope | Current status | Dependencies and risks |
| --- | --- | --- | --- | --- |
| Baseline main | `main` / `origin/main` at `2843d88c` | Stable scanner overlay baseline and production docs | Clean checkout at the latest main commit during this pass | New work should branch from main and avoid cherry-picking active PR work without review |
| V1 product integration | PR #114, branch `codex/mechanic-shop-mode`, local worktree `C:/Users/omiol/.codex/worktrees/62d6/deepspec` | V1 scanning, inspections, consent review, reports, dataset provenance, launch docs | Open, mergeable, 83 commits, updated September 30, 2026 | Very broad blast radius; do not duplicate product features from this lane |
| Identify provider map | PR #113, branch `codex/fix-identify-production-provider-map` | Route production identify through configured Groq first, preserve Gemini/HF/Ollama fallbacks, harden result parsing | Open, mergeable, 1 commit | Depends on provider configuration and live eval evidence; no paid provider usage should be introduced |
| Cloud login, sync, and billing QA | PR #112, branch `codex/cloud-login-ar-qa-billing` | Login sync, multi-scan Supabase persistence/RLS, auth fallback, billing entitlement routes | Open, mergeable, includes billing-related code | Billing and paid services are out of scope for unattended execution; keep disabled/fail-closed unless owner explicitly approves |
| Auth-gated scanner readiness | PR #109, branch `codex/blurry-label-ocr-fixture-20260527` | Real Supabase auth gate, provider fallback, camera flows | Open draft, not mergeable | Needs real email/code/OAuth and provider-quality gates |
| Durable dataset tables | PR #108, branch `codex/durable-dataset-tables-clean`, local worktree `C:/Users/omiol/deepspec-durable-dataset-clean` | Supabase scan detail tables, cloud sync detail rows, verifier expansion, CI cloud gating | Open draft, not mergeable | Hosted Supabase project still needs auth/log/schema/bucket verification before ready review |
| Production release CI gate | PR #105, branch `production-readiness-release-v60-reusable-pr` | Release gate rules for Supabase verification on production branches | Open draft, not mergeable | Should be reconciled with newer release/V1 lanes before merge |
| Scanner lens overlays stack | PR #104, branch `codex/scanner-lens-overlays-20260527` | Older scanner/auth/cloud/result stack | Open, not mergeable, based on older main | Likely stale or superseded by newer branches; treat as evidence, not a direct merge candidate |
| Site logo/release readiness | local worktree `C:/Users/omiol/.codex/worktrees/3ae0/deepspec`, branch `codex/site-logo-release-readiness` | Logo and release readiness fixes | Active local branch | Keep visual/logo changes separate from scanner, auth, and dataset work |
| Founding testers | local worktree `C:/Users/omiol/.codex/worktrees/deepspec-founding-testers`, branch `codex/founding-testers-followup` | Email-only session enforcement and tester launch docs | Active local branch | Depends on auth policy and launch decisions |
| Scanner browser evidence | local worktree `C:/Users/omiol/.codex/worktrees/deepspec-scanner-browser-evidence`, branch `codex/deepspec-v54-scanner-browser-evidence` | Browser QA evidence for scanner | Active local branch | Should feed release notes and QA matrix, not product code duplication |
| Release stack/share target | local worktree `C:/Users/omiol/.codex/worktrees/deepspec-v55-release-stack`, branch `codex/deepspec-v58-share-target` | Release/eval stack and share target work | Active local branch | Reconcile with PR #105 and PR #114 before further release-gate edits |

## Current Plans and Trackers

- `docs/PROJECT_GOAL.md` defines the product standard: reliable scanner, saved
  results, dataset-ready scan data, honest UI states, `npm run check`, browser
  verification for changed UI, and commit/push before completion.
- `docs/PRODUCTION_READINESS_GOAL_PLAN.md` remains the clearest backlog. It
  organizes work into nine production tracks and records P0/P1/P2 gaps.
- `docs/PHASE_8_SUPABASE_VALIDATION.md` defines the Supabase verifier and says
  not to move past Phase 8 until anonymous sign-in, private storage, parent scan
  rows, durable detail rows, RLS isolation, and cleanup all pass.
- `docs/AI_PROVIDER_RELIABILITY_PLAN.md` separates provider availability failures
  from model-quality failures and keeps live provider evals as release gates.
- `docs/BROWSER_QA_MATRIX.md` defines route, viewport, console, network, and
  interaction evidence expected before release.
- GitHub issues are not currently carrying the main backlog. The public issues
  API returned no standalone open issues in this pass; open PRs are carrying
  most work state.

## Cross-Lane Dependencies

1. Supabase cloud verification gates multiple lanes: durable dataset tables,
   early access/cloud copy, saved history sync, CI readiness, and production
   launch claims.
2. Provider reliability gates scanner UX claims, release evals, and any public
   accuracy/performance statement.
3. PR #114 overlaps with #108, #112, #113, and older scanner/release branches.
   Decide whether #114 is the integration spine or whether to split smaller
   PRs from it before merging adjacent work.
4. Billing-related code exists in PR #112, but unattended work must not spend
   money, enable payments, purchase services, or create financial commitments.
5. Browser QA depends on a verified Supabase session and provider keys. Without
   those, classify results as environment or provider blockers, not product
   proof.

## Decision Proposals

1. Choose a merge spine: either PR #114 becomes the V1 integration spine, or the
   owner picks smaller PRs (#108/#113/#105) to land first. Do not continue broad
   parallel product work before this is decided.
2. Convert the production readiness plan into GitHub issues/milestones once the
   active PR stack is pruned. The current issue tracker does not reflect the
   real backlog.
3. Keep paid/billing surfaces disabled and out of launch scope until an owner
   explicitly approves the business/legal path.
4. Prioritize free verification: `npm run check`, `npm run verify:auth`,
   `npm run verify:supabase`, and focused browser QA. Do not run provider evals
   that may consume paid quota unless configured as free/safe and explicitly
   intended for the current gate.

## Highest-Value Next Actions

1. Review PR #114 against main and decide whether it is the integration spine.
2. If PR #114 is not the spine, land the smallest unblocked mergeable fix first:
   likely PR #113, because it is narrow and mergeable.
3. Resolve the Supabase project blocker without changing product strategy:
   inspect Auth logs, run the printed diagnostics, apply missing migrations only
   through the existing migration flow, then rerun `npm run verify:supabase`.
4. Run `npm run check` on main and on any selected merge spine before further
   implementation.
5. Create GitHub issues/milestones from the production readiness plan after the
   PR stack is reduced, so future Codex tasks can operate from a single tracker.

## Shared Company Summary

Deep Spec should operate from `main` plus one chosen V1 integration spine. The
repo has many useful branches, but the active PR stack now carries overlapping
scanner, auth, cloud, dataset, billing, and release work. The company-level
priority is not more feature fan-out; it is deciding the merge spine, proving
Supabase and provider gates without paid commitments, and turning the documented
production plan into a tracker that future lanes can follow without collisions.

