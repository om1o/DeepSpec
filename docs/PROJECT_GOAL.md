# Deep Spec Project Goal

Build Deep Spec as a reliable, fast, polished car-part scanning PWA that works end to end for real users. A feature is not finished until it has passed debugging, framework fit, UI quality, UX validation, and the project quality gate.

Deep Spec should feel professional, responsive, and trustworthy: no broken scan flows, confusing result states, dead buttons, hidden persistence failures, overlapping text, or fake controls. Every scan photo and AI result must be preserved as dataset-ready product data for future model training and evaluation.

## Product Success Criteria

- Users can capture a car-part photo, get a clear AI result or failure state, save the scan, review it later, correct it, add notes, and continue with follow-up chat.
- Users always know where they are, what happened, what to do next, and whether saving, syncing, retrying, sharing, or feedback submission succeeded or failed.
- Saved scan data keeps the photo, AI answer, category, timestamp, confidence, rating, correction, notes, chat history, and review/training status.
- Optional Supabase sync must preserve the same dataset fields with private image storage, auth ownership, row-level security, and narrow migrations.
- Public-facing screens must be readable, responsive, and usable on mobile first, with desktop layouts still clean and stable.

## Engineering Standard

- Debug from evidence. Reproduce failures with a test, command, browser walkthrough, or logged runtime behavior before claiming a fix.
- Keep the existing React, TypeScript, Vite, Tailwind, Vitest, and Supabase shape unless current evidence proves a change is worth the risk.
- Make surgical changes. Touch only the files needed for the user-facing goal, and do not refactor unrelated code.
- Keep implementation simple. Avoid speculative abstractions, unused configuration, or features that do not directly support scanning, saved results, dataset quality, or user trust.
- Prefer visible, honest states over silent failure. If AI, camera, local storage, cloud sync, or export fails, the user should see a useful next step.

## Language And Framework Choices

- UI: TypeScript with React, React Router, Tailwind utilities, and the existing Deep Spec design tokens.
- PWA shell: Vite with `vite-plugin-pwa`.
- API layer: TypeScript serverless handlers in `api/`, reused by the local Vite dev server.
- Database: Supabase/Postgres with narrow SQL migrations and private object storage.
- Automated tests: Vitest, Testing Library, and focused service tests for persistence, AI parsing, Supabase security shape, reports, and UI state.
- Real UX validation: Playwright or a real browser walkthrough for scan, history, result, chat, early access, and mobile viewport checks.
- Scripts: Node/TypeScript or simple PowerShell on Windows when local automation is needed.

## Definition Of Done

A Deep Spec task is done only when:

1. The intended user behavior is implemented.
2. Existing behavior and dataset persistence are not regressed.
3. `npm run check` passes.
4. Any changed UI flow is verified in the running app.
5. Remaining risks are reported plainly.
6. The completed work is committed and pushed to GitHub when the local environment allows it.
