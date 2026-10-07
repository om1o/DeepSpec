# DeepSpec full interactive presentation

Open `../DeepSpec-Full-Interactive.html` in a browser. It is self-contained: no server, account or API is needed. Use chapter navigation or arrow keys outside form controls. The recovery demonstration changes only example values inside the presentation.

Rebuild after editing `interactive.template.html`:

```sh
node docs/presentations/full-product/build-interactive.mjs
```

Asset provenance:

- `hero.webp`: existing DeepSpec generated illustrative alternator art, copied from `public/brand/alternator-workbench.webp`; not a customer scan.
- `logo.webp`: existing `public/brand/deepspec-logo.webp`.
- `scan.webp`: resized actual QA screenshot from `artifacts/qa/2026-09-26T11-35-19-272Z/screenshots/scanner-ai-engine.png`.
- `history.webp`: resized seeded QA screenshot from `artifacts/qa/2026-09-21T13-42-31-354Z/screenshots/saved-history.png`.
- `shop.webp`: resized QA screenshot from `artifacts/qa/2026-09-26T00-59-11-182Z/screenshots/customer-report-export.png`.
- `recovery.webp`: resized QA screenshot from `artifacts/qa/2026-09-26T16-20-49-881Z/screenshots/inspection-stale-recovery-choice.png`.

Screenshots are feature evidence, not customer outcomes. Calculator defaults are hypothetical and must remain labeled. Counts of automated tests reference the specified historical application revision, not customer accuracy. The [foundation report](../../V1_FOUNDATION_REPORT_2026-09-26.md) records newer engineering checks.
