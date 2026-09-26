# Is Rehearsal worth continuing?

Recommendation: a small customer pilot is justified; a larger investment or a claim of proven demand is not. The tested value is controlled review and preserving important fields, not a unique cleanup algorithm. Rehearsal remains a separate inventory CSV tool from DeepSpec.

## What was actually measured

Evaluated Rehearsal source bdf9e87fc87af60687a51168971d8d863ec9e6f5 using four generated CSV workloads. These are synthetic checks, not customer observations. AI was not used. Each workload checked that unapproved proposals leave output unchanged, then approved explicit proposals and compared the exported CSV against an independent simple reference transformation. Identifiers, quantities, and prices were compared exactly, including leading zeros.

| Workload | Rows | Proposed changes | Missing IDs flagged | Protected cell values preserved | Local rule processing | Minimum review pages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Repetitive spacing cleanup | 100 | 100 | 0 | 300 | 5.58 ms | 5 |
| Already clean | 100 | 0 | 0 | 300 | 0.21 ms | 0 |
| Missing identifiers | 100 | 0 | 20 | 300 | 0.41 ms | 0 |
| Maximum supported row count | 500 | 500 | 0 | 1,500 | 7.75 ms | 25 |

All four matched the expected export, preserved row count/order and all 2,400 protected values. All 20 deliberately missing identifiers were flagged; none was fabricated. Timings are single local processing measurements excluding upload, database, network, human review, and download. They are not latency benchmarks or labor savings. Review pages assume the current UI's 20-proposal page size; setup and approval actions add effort. Duplicate detection was disabled to isolate formatting and required-field behavior; these results do not measure duplicate accuracy.

The reference algorithm used trim plus single-space normalization on description strings. Rehearsal produced the same cleaned values. That is evidence that basic formatting alone is not the differentiator. Its separately tested approvals, version handling, protected fields, original-file retention and account isolation are the more useful parts.

Earlier live hosted browser validation with a fictional file passed upload, explicit header correction, single-proposal approval, reload persistence, and CSV download initiation. It did not independently capture downloaded bytes; exact values were checked through automated service/domain tests. All 31 existing domain/service tests passed during that fix. This evaluation did not re-test the hosted service or call a model.

## Where it may help

A person receiving recurring messy supplier files, who needs to protect stock identifiers and quantities while reviewing a copy, is a plausible user. That is a hypothesis. An occasional small cleanup, already-clean file, or missing part identification is a weak fit. Rehearsal flags missing facts but cannot supply verified replacements.

The immediate product risk is review effort: 500 routine changes occupy 25 pages. Do not remove approval safeguards merely to lower that number. First observe which changes people actually inspect and whether the control is worth the extra steps.

## Next evidence needed

With one willing parts seller, compare the usual method and Rehearsal on matched supplier files. Count active minutes, mistakes, corrections after export, and places they need help. An initial proposed gate is at least 30% less active work with no additional critical-field errors, followed by voluntary reuse on another file. This is a pilot decision rule, not a result or industry standard. Willingness to pay must come from an actual buyer; no price or revenue conclusion follows from these tests.

Evaluation script and raw JSON are retained in the Rehearsal checkout under work/evaluate-value.ts and work/value-evaluation/results.json. Run with node --import tsx work/evaluate-value.ts from that checkout. No real customer files were used.

## September 26 grouped-review follow-up

Rehearsal source commit `5653090bfa4c99640e4db1d7b75cf13200439f7e` on private Sites branch `codex/grouped-format-review` implements the proposed repeated-description review. It is pushed for review, not deployed to the public site. Each group shows its exact rule/column/status and every before/after value, requires explicit confirmation, and can be revoked. Server checks bind it to the owner, input identity/hash, run revision and complete set of proposal versions. Protected and critical fields, formula-like values, uncertain changes and manual/AI suggestions remain outside groups.

Five synthetic workloads passed: small messy, clean, missing identifiers, mixed rules/protected fields and the 500-row maximum. All 2,412 protected cells and row order/count were preserved; 20 missing identifiers were flagged without replacements. In the repetitive 500-row workload, approval submissions decreased from 25 to one. This excludes inspecting all 500 changes, setup, confirmation and navigation; it is not measured staff time savings. Mixed rules required two groups. Small/clean/missing-ID workloads showed no submission reduction.

The source passed 37 domain/service tests, typecheck, lint, build, nine browser workflow checks with actual original/reviewed/revoked CSV bytes, and desktop/mobile maximum-file inspection. A stale-decision error hidden behind its modal and a clipped mobile column heading were reproduced and fixed. Local browser checks used the existing development identity and local storage services; hosted authentication and a second real account remain unverified. See the Rehearsal checkout's `VALIDATION.md`, `scripts/evaluate-grouped-review.ts` and ignored `work/grouped-review/` evidence. The next value test remains the small seller comparison above.
