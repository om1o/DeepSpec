# Browser QA Matrix

Last updated: May 27, 2026

Use this matrix before release PRs and after scanner, result, auth, history, chat, or early-access changes. It is a production browser QA checklist, not a replacement for `npm run check`, `npm run eval:identify:release`, or `npm run verify:supabase`.

## Gate Commands

```bash
npm run check
npm run eval:identify:release
npm run verify:supabase
```

If provider quota or Supabase availability blocks a gate, record the exact command, route, error code, and timestamp in the release notes. Do not mark the route production ready from component tests alone.

## Viewports

| Viewport | Size | Why it matters |
| --- | ---: | --- |
| Mobile phone | 390 x 844 | Primary scanner and bottom-sheet result surface. |
| Small phone | 375 x 667 | Protects anchored scanner cards and cramped controls. |
| Desktop | 1440 x 900 | Validates two-pane result/history layouts and long copy. |

## Core Route Matrix

| Route | Required state | Browser checks | Expected evidence |
| --- | --- | --- | --- |
| `/auth` | Signed out. In dev, Supabase config may be present. | Page renders without redirect loops. Email code form is visible. Local QA bypass is shown only in dev. Google sign-in appears only when enabled. | Snapshot shows `Sign in with a code`, email field, and either `Continue locally` in dev or no local bypass in production. Console has no errors. |
| `/scan` | Signed in or dev local bypass. Camera may be denied. | Scanner shell loads. Manual `Scan now`, `Upload photo`, and paste/drop paths remain visible. Denied camera state keeps gallery fallback available. No stale `?test=1` fixture panel appears. | Snapshot shows live scanner status plus manual controls. Mobile viewport has no overlapping header, reticle, result card, or action buttons. |
| `/result/:id` | Seed `deep-spec:lookups` with one saved scan. | Saved result opens directly. Primary match, related parts, evidence, sources, review controls, and chat entry are reachable. Delete and report/export controls do not cover content. | Snapshot shows the saved part label, `Tell me more`, review/rating controls, and no missing-data fallback. |
| `/history` | Seed at least two saved scans with different categories or ratings. | History opens with saved count, search, category filter, review/rating filters, export, and links to result detail. Empty state must not appear when seed data exists. | Snapshot shows saved scan cards, filter controls, and a working `/result/:id` link. |
| `/result/:id/chat` | Seed the same lookup used by result detail. | Chat opens from the saved scan. Prompt query parameter pre-fills/sends only when intended. Follow-up submission records chat history locally. | Snapshot shows the scan context, input, saved-scan back link, and no missing-scan fallback. |
| `/early-access` | Signed in or dev local bypass. | Waitlist and feedback sections render. Cloud readiness copy does not claim Supabase is verified unless `npm run verify:supabase` passed for this environment. | Snapshot shows waitlist email/user-type controls, feedback category/message controls, and non-contradictory cloud sync copy. |
| Unknown route | Signed in or signed out. | Unknown paths redirect through `/` to the auth-gated scanner flow without a 404 shell. | Network log has no app-route 404 and final page is `/auth` or `/scan` depending on auth state. |

## Browser Evidence To Capture

For each route and viewport:

1. Capture an accessibility snapshot.
2. Check browser console errors and warnings.
3. Check network requests for unexpected 404, 500, blocked CORS, or failed API requests.
4. Confirm interactive controls are reachable by keyboard or click.
5. Record whether the route is fully verified, blocked by provider quota, blocked by Supabase, or blocked by missing browser permission.

## Seed Lookup Shape

Use a realistic saved lookup when verifying result, history, and chat routes:

```json
{
  "id": "qa-alternator-1",
  "createdAt": "2026-05-27T00:00:00.000Z",
  "frame": {
    "imageBase64": "data:image/jpeg;base64,...",
    "capturedAt": "2026-05-27T00:00:00.000Z"
  },
  "result": {
    "partName": "Alternator",
    "confidence": "high",
    "scanCategory": "electrical",
    "candidateMatches": [
      {
        "partName": "Starter motor",
        "confidence": "medium",
        "scanCategory": "electrical",
        "reason": "Similar housing shape but different mounting position."
      }
    ],
    "whatItDoes": "Charges the battery while the engine runs.",
    "visibleObservations": ["Pulley and vented aluminum housing are visible."],
    "evidenceRegions": [],
    "concerns": [],
    "safetyTriage": "can_help",
    "isSafetyCritical": false,
    "nextAction": "Compare belt routing and connector placement.",
    "needsBetterPhoto": false,
    "evidence": ["Visible pulley", "Electrical connector"],
    "sourceLinks": []
  },
  "analyzedAt": "2026-05-27T00:00:00.000Z",
  "rating": null,
  "correction": null,
  "notes": "",
  "scanCategory": "electrical",
  "trainingLabel": "Alternator",
  "trainingStatus": "raw_unreviewed",
  "chatHistory": []
}
```
