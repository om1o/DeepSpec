# Fonts — Inter

Deep Spec uses **Inter** at weights 400, 500, 600, 700, and 800.

## How it's loaded in the source repo

From `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
```

Then `src/styles/index.css` declares:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

## Offline / production

If you need to host Inter yourself (CSP, offline, or perf reasons), download **Inter Variable** from <https://rsms.me/inter/> and drop the `.woff2` files in this folder, then add `@font-face` declarations in `colors_and_type.css`.

## Substitution

No font files are bundled in the repo. If you need to use this design system without an internet connection and have no font files, the closest available system fallbacks are: `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`. These have similar metrics on macOS/iOS/Windows and won't ruin layout — but Inter is non-negotiable for "real" deliverables.
