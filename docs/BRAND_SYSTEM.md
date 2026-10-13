# DeepSpec brand system

The electric D is DeepSpec's primary identity. Its forward-leaning silhouette combines the initial D, a mechanical rotor opening, and a bright scan cut. It is the mark customers should remember and the only symbol used for the app icon, favicon, shared product lockup, and neutral scan-image fallback.

The split inspection rotor is a secondary motion and marketing device. Its two opposing mechanical crescents and open center communicate active scanning; four rounded scan corners may surround it in animated analysis states. Blue glass is reserved for loading motion and occasional promotional artwork. Solid blue is the flat marketing/print fallback. Never substitute the rotor for the primary electric D on app-install or product identity surfaces.

## Application assets

- `public/brand/deepspec-symbol.png`: transparent electric D master used by `BrandLockup` and the cloud-history image fallback.
- `public/icon-192.png` and `public/icon-512.png`: matching electric D PWA/favicon assets on the DeepSpec ink background, with maskable padding. Physical installation/cropping still needs device evidence.
- `public/brand/deepspec-scan-badge-glass.png`: transparent blue-glass inspection rotor used by the analysis/loading animation and promotional artwork.
- `public/brand/deepspec-scan-badge-solid.png`: transparent flat inspection rotor for print and marketing fallback.
- `public/brand/deepspec-symbol-v2.webp`, `public/icon-v2-192.png`, `public/icon-v2-512.png`, and `docs/brand/deepspec-core-master.png`: retained framed-rotor exploration assets; they are not the primary runtime identity.

`BrandLockup` keeps one accessible name, `DeepSpec`, with a decorative electric D and hidden duplicate text. The wordmark uses a white `Deep` and electric-cyan `Spec` with no added letter spacing. The shared lockup appears on Auth, Scanner, History, Result, Chat, EarlyAccess, Shop, Account, and Pricing; screen tests and actual deployed visual coverage are separate evidence categories.

App surfaces use graphite `#080B10`, pale silver lettering, and restrained cyan accents. Shared Account/Pricing headers wrap to keep navigation reachable at narrow widths. No authentication, billing, scan, or AI-provider behavior is changed by this refresh.

## Artwork provenance

Created with the built-in image-generation tool from the user's DeepSpec identity directions. No third-party logo artwork was copied. The electric D and both split-rotor treatments are original generated assets on genuine transparency. Runtime motion is implemented with CSS around the glass rotor so reduced-motion users receive a static branded state and the marketing badges remain reusable.

See `DEEPSPEC_QA_REPORT.md` for revision-specific checks and remaining deployment, account, mobile, and physical-device requirements. A logo refresh does not approve a release.

## Customer and product fit review

Compared the deployed signed-out entry page with `PROJECT_GOAL.md`, `V1_LAUNCH_PLAN.md`, and the unfilled `PILOT_RUNBOOK.md`. This is a design/content assessment, not a completed customer study or proof of commercial appeal.

| Audience | What the presentation needs to explain | Decision |
| --- | --- | --- |
| Car owners | What a photo can help identify and what to do next | State the photo → AI suggestion → saved inspection workflow on the sign-in card, including the mobile-visible copy. Use a general email example rather than suggesting a shop account is required. |
| Mechanics and parts teams | Evidence, labels, records, and uncertainty | Keep the mechanical rotor/scan symbol, alternator artwork, Capture/Review/Save sequence, and the warning that a photo does not prove function. |
| Engineers and companies | Precision, traceability, and honest limits | Use graphite/silver restrained styling. Describe suggestions and evidence; do not claim certified accuracy, fitment guarantees, hidden-fault detection, or enterprise readiness. |

The Pricing screen now explains proposed preview plans and sandbox-only availability in customer language. It no longer presents static internal release stages as a product feature. Server authorization, payment/provider gates, plan identifiers, allowances, and checkout behavior are unchanged. The release checklist remains in the QA/release documentation.

The shared social card at `public/brand/deepspec-site-logo-v2-social.png` uses the secondary framed rotor as a marketing badge with the evidence-led message (1200×600). Its existing path is retained for app/article metadata. Those metadata URLs still point to the production domain: the preview asset can be inspected directly, but production share cards and external caches are unchanged until a separately approved production release.

Finish hierarchy: electric D for the primary brand and app icon; blue-glass rotor for loading motion and occasional promotional art; solid-blue rotor for flat marketing and print. Real customer preference and physical-device installation still need direct user/device feedback.
