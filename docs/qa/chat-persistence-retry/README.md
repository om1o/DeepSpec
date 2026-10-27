# Completed chat answer persistence retry

Scope: PR #119 review [4264197847](https://github.com/om1o/DeepSpec/pull/119#discussion_r4264197847).
Implementation base: `f3884c1864500358f3f59361a726e4f57a0374f5`.
Publication parent: `4ceb7898cd45bee23b1afdd7ade57f70cc28dd63`, preserving the concurrent billing-replay and scanner-accessibility fixes.
The candidate is the commit containing this report; `source-sha256.txt` identifies the tested code and tests.

## Behavior

- A completed provider response becomes a retained user/assistant exchange with stable message IDs. Failed saves leave the answer visible and expose **Retry saving answer**. This action only retries local persistence; it cannot call `sendFollowUp`.
- The composer is disabled until the retained answer is saved, preventing a new question from replacing it. Provider failures without an answer still use the existing question retry. Disabled chat continues to save no unanswered question.
- Storage merges by message ID. Repeating a full or partial write preserves one copy of each message and repairs the auxiliary history. Stale auxiliary history cannot hide the completed exchange in the primary lookup, even if auxiliary cleanup also failed. Identical text with different message IDs remains distinct.
- Retries read the current lookup, preserve newer messages and the existing 40-message cap, and do not recreate a deleted scan.
- Conversation state is scoped to the scan route and account generation. Unmount, route changes, logout, and account switches invalidate late answers or stale retry actions. A synchronous account switch during the primary-write notification cannot write the auxiliary history into the next account.

## Verification

All provider responses and storage faults in these tests are synthetic. No live provider request, payment, production chat enablement, authorization change, spending-protection change, merge, or manual deployment was performed.

- Before the implementation, the updated Chat/storage regression suite reported **15 failures / 71 passes** (86 total), reproducing lost answers, provider retry instead of save retry, duplicate writes, stale auxiliary history, and transitions.
- After the implementation: **86/86** Chat/storage tests pass.
- Final integrated protection checks: **137/137 tests across 8 files** pass (includes the concurrent scanner overlay regressions). Command:

  ```sh
  npm test -- src/screens/Chat.test.tsx src/services/storage.test.ts src/App.test.tsx src/lib/accountScope.test.ts src/services/aiService.test.ts server/chat.shared.test.ts api/chat.test.ts src/screens/AnalyzingOverlay.test.tsx
  ```

- Full ESLint, `npx tsc -b`, production build, and public/brand asset checks pass. The existing Transformers bundle-size warning remains.
- Full `npm run check` on the initial base plus this fix: **1,395 tests passed / 1 failed across 101 files**. After rebasing onto the concurrent billing-replay commit `f54ad598`: **1,404 passed / 1 failed across 101 files**. The later scanner-only integration was verified with the final focused suite, full lint and build rather than a third full-suite run. The sole failure is the existing `server/vercel-layout.test.ts` failure because `api/chat.test.ts` is in the endpoint directory. This unchanged issue is separately tracked by [review 4264265132](https://github.com/om1o/DeepSpec/pull/119#discussion_r4264265132). A whole-suite pass is not claimed. Since this command stops at the test failure, the production build and asset checks were run separately and passed.

- Independent read-only QA review found no blockers and independently reran the 86 Chat/storage tests successfully.

## Limits

When the primary write fails, the completed answer is retained only on the current page. The UI explicitly asks the user to retry saving before leaving or reloading. It is deliberately not cached across pages/accounts or presented as durable. When only the auxiliary write fails, the primary lookup already holds the exchange and reopening displays it without another provider request. Tests exercise both cases.

These results do not establish live provider availability, deployment success, physical-device behavior, or release readiness.
