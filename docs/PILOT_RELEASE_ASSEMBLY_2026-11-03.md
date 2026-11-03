# Local supervised-pilot candidate

This candidate combines the hosted base `e8e66023a0ab19c12138d7f0df2205048bb19501`, the camera/Chat/Result work later recorded as `4ac783f6205fa467c4890a435572e463e78f91a1`, a Chat retry/cloud-save serialization repair, the reconstructed billing repair, React Router 7.18.5, and the one-line Windows SQL-fixture normalization also recorded in `6c1641c5709f33d74125b895a2f56a37bcd2972a`. The original active checkout and the old mechanic-shop checkout were preserved.

## Verification

- Clean, integrity-verified Vitest 4.1.12 with standard worker and 15-second functional deadlines: eight UI/auth/cloud-sync files, **232 passed**; six billing/scan-credit/API files in Node environment, **102 passed**.
- Windows schema-fixture normalization: **25 passed**, plus focused lint. SQL and database migrations are unchanged. Total relevant tests in this assembled candidate: **359 passed**.
- TypeScript projects, changed-file ESLint, production build, public-asset integrity and brand-asset checks passed. Vite reports existing chunks larger than 500 kB; actual iPad/network performance remains to be measured.
- The production-only audit of this exact lockfile reports zero known vulnerabilities. Development dependency findings are separate and are not claimed resolved.
- The first build attempt failed because the isolated dependency arrangement lacked npm command shims. Adding local npm-generated shims resolved the environment issue; the normal `npm run build` subsequently passed. No assertion, application behavior or timeout was weakened.

Evidence is in ignored `artifacts/qa/assembled-pilot-20261103/` and in the coordinator's user-facing verification package. Unchanged dependencies were reused through junctions; the router packages and pristine Vitest were copied locally. No shared dependency file was changed by this assembly.

## Release limits

This is a verified source candidate, not a hosted or physical-device acceptance result. The review branch is `codex/pilot-assembled-20261103`; `vercel.json` disables automatic Git deployments for this exact branch. Other branches retain their existing behavior. The tracked preview-repair workflow is restricted to a different branch. Source publication does not authorize a merge, public deployment or billing activation.

The billing patch preserves `apply_billing_purchase` and its existing receipt ledger; historical unpaid receipts, real database concurrency and complete provider lifecycle acceptance still need authorized verification. A read-only live database review on 2026-11-03 confirmed an active/healthy project, RLS enabled on all 23 public tables, and denied client execution for all three public SECURITY DEFINER functions. The eight no-policy tables intentionally have server-only access. This catalog review does not replace two-account isolation, deletion, provider-lifecycle or database-concurrency tests. Leaked-password protection remains disabled in the live Auth settings.

The branch-specific deployment guard follows https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled (checked 2026-11-03). The earlier 359-test evidence covers unchanged application code; the final publication adds this documentation and the deployment guard only. The exact published tree and focused configuration checks are recorded in the publication receipt.

Next acceptance must use an approved deployment of this exact candidate, two dedicated confirmed QA accounts and the user's iPad. Verify sign-in, camera/upload, identification, save/history/reopen, chat, failure recovery, account isolation, deletion and limits. Record model/iPadOS and latency. No phone coverage or customer benefit is inferred from tablet or unit tests. Configure secrets privately, never in chat or Git.

No company has agreed to a pilot. The proposed Branif evaluation stays free and supervised until readiness and a concrete company agreement exist. Dad is the user's named contracts/payment contact; no commercial outreach is authorized by this engineering record.
