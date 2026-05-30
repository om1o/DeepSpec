# Deep Spec — Scanner PWA UI Kit

High-fidelity React recreation of the live Deep Spec product, factored into small reusable components. Lifts the actual class strings, radii, opacities, and copy out of [om1o/DeepSpec](https://github.com/om1o/DeepSpec) `src/` and rebuilds the five core screens as a click-through prototype.

## Run it

Open `index.html` in any modern browser. Tailwind is loaded from the CDN; Inter is loaded from Google Fonts; React and Babel-Standalone come from unpkg. No build step.

## Files

| File | Purpose |
|---|---|
| `index.html` | Loads React, Tailwind, the component scripts, and renders the app inside an iPhone-15 frame. |
| `App.jsx` | Top-level shell — phone frame + simple hash-based screen router + a faux status bar. |
| `components/Primitives.jsx` | `Button`, `GhostButton`, `DangerButton`, `Pill`, `ConfidenceBadge`, `EvidenceChip`, `GlassPill`, `Wordmark`. |
| `components/Reticle.jsx` | Yellow dashed scanner reticle + 4 corner brackets, plus the scrim helpers. |
| `components/Cards.jsx` | `PrimaryCard`, `NestedRow`, `TrustReviewCard`, `EvidenceCard`, `WarningCard`. |
| `components/Inputs.jsx` | `TextInput`, `TextArea`, `Select`, `FieldLabel`. |
| `components/Header.jsx` | Mobile screen header — eyebrow wordmark + title + back/action pills. |
| `screens/Scanner.jsx` | `/` — viewfinder, reticle, Identify button. |
| `screens/Result.jsx` | `/result/:id` — AI identification + trust check + evidence. |
| `screens/History.jsx` | `/history` — saved-scan list with thumbnails. |
| `screens/Chat.jsx` | `/result/:id/chat` — follow-up Q&A scoped to a scan. |
| `screens/EarlyAccess.jsx` | `/early-access` — waitlist + feedback forms. |

## What's faithful, what's faked

- **Faithful:** every component, every Tailwind class, every radius / opacity / shadow / focus-state, every string of copy.
- **Faked:** the camera feed (rendered as a moody gradient placeholder), the AI calls (results are hardcoded), saved-scan persistence (in-memory state), and routing (no `react-router`; a tiny hash-based switcher).
- **Omitted:** the early-access engagement counters, Supabase cloud sync, scan-report export, motion-permission modal. These live in the source codebase as `services/*` and can be lifted as needed.

## How to lift components into a new design

1. Open the component file you want.
2. Copy the JSX — every component uses inline Tailwind classes plus a handful of CSS vars from `../../colors_and_type.css` (which the components also work without — they're self-contained on Tailwind).
3. Paste into your own React file.

Components are written without prop-drilling design tokens — colors and radii are inline so each component is portable in a single copy-paste.
