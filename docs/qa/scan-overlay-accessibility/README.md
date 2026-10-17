# Scan overlay live-region regression

## Scope and source

- PR: https://github.com/om1o/DeepSpec/pull/119
- Finding: https://github.com/om1o/DeepSpec/pull/119#discussion_r4243435339
- Base inspected: `f3884c1864500358f3f59361a726e4f57a0374f5`.
- Changed component: `src/screens/Scanner.tsx`, `AnalyzingOverlay`.

The visible elapsed-time paragraph is now a sibling of the polite status region.
It remains available for normal reading, but its per-second changes do not mutate
the live subtree. Analysis-step, offline-model download, and the existing
eight-second “Almost done.” messages remain inside that same status region.
Cancellation, timer cadence, download subscription, styling, image asset, and
animation logic are unchanged.

## Verification

The regression suite was run before changing the component: **2 failed, 3 passed**.
Both failures showed elapsed time included in the live status. After the fix:

- `npm test -- src/screens/AnalyzingOverlay.test.tsx src/screens/Scanner.test.tsx src/services/onDeviceIdentify.test.ts`:
  **63 tests passed across 3 files**, including all 5 overlay tests.
- Full ESLint (`npm run lint`, executed by `npm run check`): **passed**.
- TypeScript (`tsc -b`, executed by `npm run build`): **passed**.
- Production build and public/branding asset integrity checks (`npm run build`): **passed**.
  The existing Transformers chunk-size warning remains.
- `git diff --check`: **passed**.
- Repository-wide `npm run check` on the original inspected base plus this fix:
  **1,384 tests passed, 1 failed across 101 files**.
  The only failure is the pre-existing `server/vercel-layout.test.ts` expectation
  that `api/` contains only the six endpoints; `api/chat.test.ts` is also present.
  This is tracked separately at
  https://github.com/om1o/DeepSpec/pull/119#discussion_r4264265132.
  The combined check exits before its build step, so `npm run build` was run
  independently and passed. No whole-repository green check is claimed.

Command output is retained alongside this report in `before-tests.txt`,
`component-tests.txt`, `check.txt`, and `build.txt`.

Before publication, the PR advanced to
`f54ad59879ecc5a798324a7fd052de5288f753bc` with an unrelated billing-verifier fix.
This change was reapplied on that head without conflicts or changes to the
scanner implementation/tests. On the combined tree, all **63 relevant tests**,
full lint, TypeScript, production build, and asset checks passed again. See
`integrated-component-tests.txt` and `integrated-build.txt`. The full-suite count
above belongs to the earlier tree; the entire suite was not repeated on the
combined tree. A separate read-only review found no blocking issue in this fix.

The focused tests verify:

1. The timer stays visible, outside live regions, and outside `aria-hidden` content.
2. Each of the first seven timer ticks leaves the status DOM unchanged; the
   eight-second progress transition changes it; subsequent timer-only ticks do not.
3. Analysis-step changes update the same polite status node.
4. Download percentages remain in the status, including after eight seconds;
   download completion restores the existing progress copy.
5. The accessible Cancel scan button invokes its callback, and unmount removes
   the interval and download-progress subscription.

These are React Testing Library/jsdom structural and DOM-mutation checks using
fake timers and simulated download events. They **do not prove which words a
screen reader speaks, their timing, or announcement queue behavior**. No live
provider requests or model downloads were made.

## Environment and remaining verification

Node `v24.19.0`, npm `11.9.0`. Reused installed dependencies whose source checkout
has a byte-identical `package-lock.json`; no dependency files changed. Repository
CI uses Node 22, so the local run is not a claim of a remote CI pass.

Actual assistive-technology testing is **not performed**: this Linux execution
environment has no available screen reader or accessible desktop session.
The configured Playwright Chromium executable is also absent. Browser-rendered
appearance and physical-device behavior were not independently verified; the
existing CSS classes, styles, image, and animation code are unchanged.

Remaining manual acceptance with VoiceOver/Safari or NVDA/Firefox/Chrome:

1. Start a scan and listen through timer-only ticks, including after eight seconds.
   Confirm no recurring elapsed-time announcements.
2. Trigger analysis-step and offline-model download updates. Confirm meaningful
   messages remain audible without a timer repeatedly replacing queued speech.
3. Navigate to and activate Cancel scan with the keyboard/screen reader.
4. Compare the overlay visually at mobile and desktop sizes while time advances.

This scoped fix is not release approval. Other PR findings and release gates
remain separate. No merge or release promotion is included.
