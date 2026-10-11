# DeepSpec inspection rotor

The symbol represents an engineered part opened by an inspection scan. Its circular segmented body echoes a mechanical rotor; the open center and stepped joints suggest scanning and sensing. It replaces the interim letter-shaped mark at the user's request.

Keep the circular silhouette, open center, three broad segments, stepped joints, and four separate rounded scan corners together. Material may change between flat graphite, inverse white, satin silver, blue glass, and solid blue; the geometry must remain recognizable. Use a flat treatment for print or very small marks, silver on dark app surfaces, and blue glass for occasional promotional artwork. Do not add gear teeth, circuit traces, gradients to the wordmark, or a surrounding badge to the in-app lockup.

## Application assets

- `public/brand/deepspec-symbol-v2.webp`: 192×192 transparent runtime mark, 11,488 bytes. Shared by `BrandLockup` and the cloud-history image fallback.
- `public/icon-v2-192.png` and `public/icon-v2-512.png`: matching PWA/favicon assets on graphite, with padding for maskable use. Physical installation/cropping still needs device evidence.
- `docs/brand/deepspec-core-master.png`: original generated transparent artwork, retained outside the public bundle. Runtime code must use the small WebP.

`BrandLockup` keeps one accessible name, `DeepSpec`, with a decorative image and hidden duplicate text. It renders the mark at 32, 40, or 52 CSS pixels. The wordmark uses the native UI font stack with restrained weight and spacing. The shared lockup appears on Auth, Scanner, History, Result, Chat, EarlyAccess, Shop, Account, and Pricing; screen tests and actual deployed visual coverage are separate evidence categories.

App surfaces use graphite `#080B10`, pale silver lettering, and restrained cyan accents. Shared Account/Pricing headers wrap to keep navigation reachable at narrow widths. No authentication, billing, scan, or AI-provider behavior is changed by this refresh.

## Artwork provenance

Created with the built-in image-generation tool, using the user's selected DeepSpec identity board as the visual reference. No third-party logo artwork was copied. The final board prompt retained its typography and three material studies while replacing the interim letter and hexagonal marks with a round segmented rotor, a circular opening, and stepped sensing joints, using the original rotor/circuit artwork as the shape reference; the final user refinement restores four rounded scanning corners. The production prompt extracted the same symbol in pale satin silver on genuine transparency, without text, shadow, glow, or background. The PNG was then cropped, resized, and encoded for app delivery; those exports preserve the artwork's alpha and geometry.

See `DEEPSPEC_QA_REPORT.md` for revision-specific checks and remaining deployment, account, mobile, and physical-device requirements. A logo refresh does not approve a release.

## Customer and product fit review

Compared the deployed signed-out entry page with `PROJECT_GOAL.md`, `V1_LAUNCH_PLAN.md`, and the unfilled `PILOT_RUNBOOK.md`. This is a design/content assessment, not a completed customer study or proof of commercial appeal.

| Audience | What the presentation needs to explain | Decision |
| --- | --- | --- |
| Car owners | What a photo can help identify and what to do next | State the photo → AI suggestion → saved inspection workflow on the sign-in card, including the mobile-visible copy. Use a general email example rather than suggesting a shop account is required. |
| Mechanics and parts teams | Evidence, labels, records, and uncertainty | Keep the mechanical rotor/scan symbol, alternator artwork, Capture/Review/Save sequence, and the warning that a photo does not prove function. |
| Engineers and companies | Precision, traceability, and honest limits | Use graphite/silver restrained styling. Describe suggestions and evidence; do not claim certified accuracy, fitment guarantees, hidden-fault detection, or enterprise readiness. |

The Pricing screen now explains proposed preview plans and sandbox-only availability in customer language. It no longer presents static internal release stages as a product feature. Server authorization, payment/provider gates, plan identifiers, allowances, and checkout behavior are unchanged. The release checklist remains in the QA/release documentation.

The shared social card at `public/brand/deepspec-site-logo-v2-social.png` now uses the same framed rotor, wordmark, and evidence-led message (1200×600). Its existing path is retained for app/article metadata. Those metadata URLs still point to the production domain: the preview asset can be inspected directly, but production share cards and external caches are unchanged until a separately approved production release. The generated card prompt used the approved satin-silver symbol and exact line “Photograph a part. Review the evidence.”

Finish choices: graphite for the core identity/print, inverse white for small high-contrast placements, satin silver for the dark app, blue glass for promotional art, and solid blue for flat accent use. Real customer preference and mobile readability still need direct user/device feedback.
