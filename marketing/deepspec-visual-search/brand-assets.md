# DeepSpec logo integration

Primary identity: white. Blue glass remains an intro accent. All logo artwork stays static.

- `dist/assets/white-logo-horizontal.svg`: 260×62 intrinsic size. Recommended header placement: 180×43 (or 156×37 on mobile).
- `dist/assets/white-mark.svg`: 64×64 intrinsic size. Use when an icon-only mark is needed.

Both files embed the existing selected white logo source and crop its exact original symbol and wordmark using SVG viewports. No letters or logo geometry are redrawn. A static luminance-to-alpha filter converts the navy background into transparency, so the white artwork works on the page's graphite/navy surfaces without a visible rectangle. No CSS blend mode or extra image filter is needed.

Browser inspection checked the horizontal lockup at 260, 180 and 156 pixels wide on three dark background colors. Edges are clean, typography remains readable and no navy tile or alpha glow appears.

Unused failed native transparent export: `exec-0155f883-ff9d-4074-82b5-68950fc0b887.png` has a broad alpha glow and must not be shipped.

## Secondary blue-glass exports

- `dist/assets/blue-glass-logo.svg`: 260×62 horizontal lockup.
- `dist/assets/blue-glass-mark.svg`: 128×128 symbol only.

These wrappers crop the original selected blue-glass raster without redrawing its geometry, typography or RGB colors. A static SVG luminance-to-alpha filter removes the padded navy background, preserving the brighter glass surfaces and white wordmark. Browser inspection passed on graphite `#0b1520`, phone navy `#07182a`, and an overlay-blue pane `#1b629b`; no rectangular tile or white alpha haze appears. Blue-glass use remains secondary to the white primary identity. No logo animation is included.
