# Result and chat visual follow-up

Assistant-authored implementation, 2026-09-21. This is a visual refinement of DeepSpec's existing result and follow-up chat workflows, not a new identification capability.

## Changes

- Align result cards, intake drafts, inspection forms and chat with the dark workbench palette used by the library.
- Put saved-scan navigation in the page header instead of a floating dock over content.
- Improve keyboard focus visibility, message wrapping and sender labels. Preserve multiline chat messages.
- Keep uncertainty, inspection and safety information visible. Replace the old automatic-training promise with a separate-permission explanation.
- Move the optional result diagnostics overlay below navigation. Debug mode still overlays part of the image by design; it is not part of the normal customer UI.

## Verification

- Focused Vitest run: 4 files, 54 tests passed (Chat, Result, PartInspectionForm, PositiveAnswerCard).
- ESLint and production TypeScript/Vite build passed. Build retains the existing large-chunk warning for the model library; this pass does not resolve model download size or measure performance.
- QA doctor passed: `artifacts/qa/2026-09-21T14-57-21-871Z/qa-doctor.md`.
- Mobile 390 x 844 auth-login, result-detail and result-chat passed: `artifacts/qa/2026-09-21T14-57-43-849Z/report.md`.
- Desktop 1440 x 900 same scenarios passed: `artifacts/qa/2026-09-21T15-01-18-641Z/report.md`.
- Final mobile auth-login and result-detail recheck after moving diagnostics passed: `artifacts/qa/2026-09-21T15-03-03-357Z/report.md`.
- Screenshots visually inspected for result/chat layout, readable text and navigation placement. Each report folder retains screenshots, trace and video evidence.

## Limits

Browser checks used anonymous Supabase login and a seeded saved scan. Chat was opened and a question typed, not submitted to a live model. Component tests cover chat behavior with test doubles. The fixture deliberately has no usable photo, so the visible photo-unavailable placeholder is expected. These checks do not establish real-part identification accuracy, customer time savings, complete authentication coverage, or production readiness. DeepSpec was verified locally; this change does not deploy its hosted website.

The separate Rehearsal assessment is in `REHEARSAL_VALUE_EVALUATION_2026-09-21.md`: worth a small pilot, with customer value still unproven.
