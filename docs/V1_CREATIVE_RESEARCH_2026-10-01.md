# DeepSpec V1 product and creative research

Date: October 1, 2026

Purpose: sharpen the V1 position, improve tester recruitment, and identify the next product ideas worth testing. This is research and product direction, not proof of customer demand or model accuracy.

## The credible V1 position

DeepSpec should not claim to replace an experienced engineer, mechanic, catalog, or fitment database. Its strongest current use is:

> Photograph an unfamiliar vehicle part, review what the model saw, ask a focused follow-up, and keep the photo, answer, and correction in one record.

The value changes by audience:

| Audience | Useful job | DeepSpec boundary |
| --- | --- | --- |
| DIY owner | Understand a visible part and prepare a better question for a mechanic | No proof of function, fitment, or repair safety |
| Trainee | Compare a first impression with visible evidence and learn what to inspect next | Not an authority or substitute for supervised training |
| Experienced technician | Record an unusual part, explain it to someone else, or teach a newer teammate | The technician may already know the identity |
| Parts seller or salvage team | Keep a searchable intake record when inventory arrives with incomplete labels | No exact catalog match unless independent evidence supports it |
| Shop advisor or marketplace seller | Prepare a clearer handoff, customer explanation, or listing note | No valuation, warranty, or compatibility guarantee |

## Product comparison

| Product | What it establishes | DeepSpec implication |
| --- | --- | --- |
| [Google Lens](https://support.google.com/websearch/answer/1325808?hl=en) | Camera or uploaded image, selectable region, visual matches, and “Ask about this image” refinement are normal expectations for visual search. | Keep capture, target selection, and follow-up close together. Do not bury refinement in a separate workflow. |
| [Partium](https://docs.partium.io/partium-find/partium-search-engine/how-partium-image-part-search-works/) | Industrial part search combines an image with text and catalog master data. Visual similarity becomes stronger when reference images exist. | DeepSpec cannot honestly promise exact catalog identification from a general model alone. OCR, part numbers, and verified references should raise confidence. |
| [PartsTech Visual Search Suite](https://get.partstech.com/hubfs/PDFs/2024_Event%20Page_PDFs/PartsTech%20Visual%20Search%20Suite%20One%20Pager.pdf) | Repair shops already use diagrams, 360-degree views, supplier inventory, and ordering context to reduce selection errors. | Shop procurement is a later integration opportunity. V1 should focus on evidence capture and explanation rather than duplicate a full ordering platform. |
| [Partful](https://partful.io/solutions/oem-spare-parts-software) | OEM-focused 3D catalogs rely on CAD and bill-of-material data. | Do not make 3D reconstruction a V1 dependency. A real catalog relationship would be more valuable than cosmetic 3D. |

## Creative direction

1. Lead with the physical part or an actual scan result, not abstract AI decoration.
2. Use one dominant image and one primary action in the first viewport.
3. Keep the palette mostly black, white, and metal, with cool blue for actions and a small warm signal color for warnings.
4. Show the product record as proof below the offer. Avoid internal cloud-health and engineering diagnostics on recruitment pages.
5. Keep claims concrete: visible evidence, saved records, follow-up questions, and corrections. Avoid unmeasured accuracy, savings, or revenue claims.
6. Use DeepSpec as one word in all public copy.

## Tester program design

The tester invitation should be public. Requiring an account before someone can read the offer or apply adds friction before intent is known.

The V1 assignment is intentionally small:

1. Scan 10 real parts.
2. Mark every answer right, wrong, or unresolved.
3. Send at least three specific feedback notes.
4. Reopen at least three saved records.

The reward can motivate participation, but it is a real commitment. The current offer is free beta access plus six months after paid launch for accepted testers who complete the checklist. Approved seller or shop pilots can receive up to one year only when the scope is agreed before testing.

Google Play's current closed-test guidance recommends a clear test brief, an explicit feedback channel, and evidence of how testers used the product. Its 12-testers-for-14-days rule applies to qualifying Android developer accounts, not to this web beta, but the discipline is useful for DeepSpec. Source: [Google Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).

## Ideas worth building or testing

| Priority | Idea | Why it helps | V1 decision |
| --- | --- | --- | --- |
| P0 | Explicit right, wrong, or unresolved result state | Produces cleaner feedback than forcing uncertainty into a yes/no rating | Build before the tester cohort |
| P0 | Next-photo mission | Tell the user whether to capture the label, connector, mounting face, or wider context | Test with the existing follow-up flow before adding multi-image inference |
| P0 | Public tester page | Lets prospects understand the offer and apply without creating an account first | Implemented in the current V1 branch |
| P1 | Tester progress view | Shows completed scans, judged results, feedback notes, and reopened records | Add after the event definitions are reliable across devices |
| P1 | Shareable read-only scan brief | Helps a DIY owner hand evidence to a mechanic and helps a seller explain a listing | Start with the existing text report, then test a private link |
| P1 | Confirmed label and part-number capture | OCR plus human confirmation can narrow exact identity without pretending the photo proved it | Extend the existing OCR evidence path |
| P2 | Multi-angle evidence bundle | Different views can reduce ambiguity and make corrections more useful | Evaluate cost and latency after the single-photo beta |
| P2 | Catalog or inventory connector | Verified references can move DeepSpec from broad identity toward an exact match | Requires a real partner or licensed data source |

## SEO direction

Google supports `SoftwareApplication` structured data and recommends validating it, keeping marked-up content visible, and ensuring pages are crawlable. Source: [Google Search software app structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app).

V1 SEO should therefore use:

- one consistent product name and description;
- a crawlable tester URL in the sitemap;
- an honest application schema with no invented ratings;
- a large social image showing the real product category;
- articles that answer distinct user questions instead of duplicate keyword pages.

The sitemap should list the canonical HTML pages, not their Markdown source copies.

## Remaining V1 evidence gates

Creative polish cannot prove launch readiness. The current repository still requires:

- a labeled automotive evaluation with a working configured provider;
- physical iOS and Android testing, including interruption and low-connectivity cases;
- real tester observations and retained wrong/failed attempts;
- deployed monitoring, cost controls, access checks, and rollback evidence;
- configured GitHub Actions public Supabase values;
- payment and shared-shop features to remain disabled until their separate blockers pass.

No third-party code or creative asset was copied for this research. Product behavior and visual patterns were used only as comparison evidence.
