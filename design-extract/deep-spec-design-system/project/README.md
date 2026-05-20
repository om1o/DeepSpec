# Deep Spec — Design System

> **The mechanical professional.** A camera-first AI helper for car owners who need to know what they're looking at — without the parts-catalog jargon. Deep Spec turns a phone into a steady-handed, safety-conscious scanner: point, hold still, identify, save, ask follow-ups.

This design system captures the visual language, voice, and component vocabulary of the [Deep Spec](https://deepspec.app) mobile PWA so that future surfaces (marketing pages, app extensions, slides, settings screens, etc.) stay recognizably the same product.

---

## Sources

- **Primary codebase** — [github.com/om1o/DeepSpec](https://github.com/om1o/DeepSpec) (`src/` React + Vite + Tailwind v4 PWA). All foundations were extracted directly from this repo.
- **Brand mark (uploaded)** — The 1:1 black squircle app icon: hex-bolt frame + camera lens + cyan focus-bracket reticle on near-black. See `assets/deepspec-app-icon.png`.
- **PWA icons (in-repo)** — `public/icon-192.png`, `public/icon-512.png` (copied to `assets/`).
- **Voice + content reference** — Repo `README.md`, `public/llms.txt`, and inline copy from every screen in `src/screens/`.

If you have access, **explore the repository** — `src/screens/Scanner.tsx`, `Result.tsx`, `History.tsx`, `Chat.tsx`, and `EarlyAccess.tsx` are the source of truth for every component pattern in this system.

---

## What Deep Spec is

A mobile-first Progressive Web App. **One product, one platform** (for now):

| Surface | Purpose |
|---|---|
| **Scanner** (`/`) | Fullscreen rear-camera viewfinder with a yellow dashed reticle. When the IMU detects the phone is steady, an "Identify" pill appears. |
| **Result** (`/result/:id`) | The captured frame + Gemini's identification, a "Trust check" card, evidence chips, safety triage, save controls, share/export. |
| **History** (`/history`) | Local list of saved scans (capped at 50) — photo thumbnail + part name + status. |
| **Chat** (`/result/:id/chat`) | Follow-up Q&A scoped to a single saved scan. |
| **Early access** (`/early-access`) | Waitlist + feedback experiment for demand validation. |

It is **not** a parts catalog, OEM fitment database, or repair-approval tool. The product loudly says "verify with a mechanic" for anything safety-critical — that posture leaks into the visual language (yellow caution, amber/red triage cards).

---

## Index

| File / folder | Purpose |
|---|---|
| `README.md` | This file — full design + voice guide. |
| `colors_and_type.css` | All foundation tokens as CSS custom properties + utility classes. |
| `SKILL.md` | Agent-skill manifest for Claude Code / cross-tool use. |
| `assets/` | Logos, app icons, brand glyphs. |
| `fonts/` | Local copies / @import notes for the typeface. |
| `preview/` | Per-token preview cards (typography, color, components) rendered in the Design System tab. |
| `ui_kits/scanner-pwa/` | High-fidelity React recreation of the Deep Spec PWA — components + interactive `index.html`. |

---

## CONTENT FUNDAMENTALS

Deep Spec's copy is **short, declarative, and protective of the reader.** It reads like a careful mechanic who respects your time but won't bless a repair they can't see clearly.

### Voice in one paragraph

Plain English. Subject-verb-object. No marketing adjectives. Every sentence is either telling the user what the app just did, what it would do next, or what they should do. Caveats are explicit, not buried — and they're written like safety briefings, not legal disclaimers.

### Tone & casing

- **Sentence case everywhere.** Screen titles, button labels, card eyebrows — `Saved scans`, `Try another scan`, `Trust check`. Never Title Case.
- **Eyebrows are SHOUTED.** Tiny uppercase tags with letter-spacing (`tracking-[0.14em–0.18em]`, `font-extrabold`) — `DEEP SPEC`, `DATASET CATEGORY`, `RETAKE GUIDANCE`. These are the *only* uppercase strings in the UI.
- **Status verbs over status nouns.** "Saved on this device" not "Save status: complete". "Analyzing photo…" not "In progress".
- **Pronouns.** Mostly **you** (instructing). Occasionally **I** in chat-bubble copy ("I can explain the scan, but risky repairs need a mechanic.") and **we / Deep Spec** in trust copy ("Deep Spec can explain the visible clues…"). Never `we` corporate-plural.
- **No exclamation points.** No `!` anywhere in production strings. Confidence comes from terseness.
- **No emoji. No unicode glyphs as icons.** Status is signalled by color + a short word ("Helpful", "Wrong", "Useful match", "Low-confidence result").
- **Numbers are written as digits.** "50 saved scans", "240" character counter — including counters: `{question.length}/500`.
- **Ellipses are typed as `...`** (three ASCII dots), not `…`. e.g. `Analyzing photo...`, `Thinking...`.

### Specific examples from the repo

| Place | Exact string | What's working |
|---|---|---|
| Scanner subtitle (idle) | `Point at a car part and hold steady` | Imperative, present-tense, no fluff. |
| Scanner subtitle (steady) | `Hold steady and scan the part` | Updates as state changes — never a generic "ready". |
| Identify button | `Identify` | One word. Verbs > nouns. |
| Trust check eyebrow | `Trust check` | Reframes "confidence" as something more human. |
| Trust status copy | `The image has enough visual evidence for a useful consumer-level explanation.` | Plain, specific, hedged honestly. |
| Safety warning body | `Verify this with a mechanic before driving or attempting repair.` | No softening; the danger is named. |
| Empty state H2 | `Scan your first part` | Action, not "Nothing here yet". |
| Cloud sync caption | `This is the data moat for improving Deep Spec later.` | Honest about why we're collecting. |
| Storage warning eyebrow | `Not saved locally` | Names the actual problem in three words. |
| Chat empty | `Ask one clear question about this saved scan.` | Sets quality expectation, not just permission. |
| Early access pitch | `Prove people want this before charging.` | Talks to the builder, not the customer — Deep Spec is early enough that this honesty is part of the voice. |

### Vibe

**Mechanical, professional, slightly nerdy, never cute.** The product is for someone standing in a parking lot or under a hood, not a designer scrolling Twitter. Copy assumes the reader has a real problem (used-car inspection, weird leak, weekend-wrench job) and treats them as competent adults who just don't know the part name.

---

## VISUAL FOUNDATIONS

### Mood

A photography app crossed with a workshop manual. **Pure black behind the camera feed**, white text, a single signal-yellow accent for the reticle / "ready" states, and traffic-light semantic colors for triage. Nothing decorative — every color earns a job.

### Color

Three concentric layers:

1. **Greyscale** is the chassis. `#0A0A0A` page → `#171717` card → `rgba(255,255,255,0.04)` nested row. Foregrounds step down through `white → white/92 → white/70 → white/42 → white/32` instead of using separate grey tokens. This `white/<n>` opacity scale is the system's most-used pattern.
2. **Brand yellow** (`#FACC15` "scanner yellow") shows up *only* on: the reticle dashed border, the "DEEP SPEC" wordmark accent, status eyebrows on cards (`text-[#FACC15]`), and as the focus-ring color for inputs (`focus:border-[#FACC15]/50`). It is the visual signature of the product and is rationed accordingly.
3. **Semantic triage** mirrors automotive dashboard lights: green `#10B981` (high confidence, "useful match"), amber `#F59E0B` / `#FACC15` (better photo, check angle), red `#EF4444` (errors, low confidence, delete). Each pairs a 10–15% opacity fill with a 25–35% opacity border and a softened ink (`#6EE7B7`, `#FCD34D`, `#FCA5A5`).

A **single blue** (`#3B82F6`) shows up exclusively on the evidence chips ("Why Deep Spec thinks this") — it's the "data / metadata" color, never used elsewhere.

### Typography

- **Single family: Inter.** Loaded from Google Fonts at weights 400/500/600/700/800. No display face, no serif.
- **Weight does the heavy lifting.** Headings are 800 (extrabold), body is 500 (medium), uppercase eyebrows are 800. There's no 300 or 100 anywhere — Deep Spec never feels delicate.
- **Tracking:** display gets `-0.02em` (`tracking-tight`); eyebrows get `+0.14em` to `+0.18em` (the wordmark). Body is neutral.
- **Size scale is short:** 24 (H1) / 20 (H2) / 16 (H3) / 14 (body) / 12 (caption) / 11 (eyebrow). No 13s, no 15s, no 18s. Mobile-first means a tight scale.

### Spacing

4-px grid (Tailwind defaults). Card interiors are `20px` (`p-5`), cards stack with `16px` gaps, and the mobile content frame is **always** `max-w-md` (448px) centered with `16px` horizontal gutters. Safe-area insets (`env(safe-area-inset-top/bottom)`) are honored everywhere — Deep Spec is iPhone-aware.

### Backgrounds

- **No gradients as decoration.** The only gradient in the system is the dimming scrim over the camera feed: `linear-gradient(to bottom, rgba(0,0,0,0.52), rgba(0,0,0,0) 28%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.62))` — bottom and top fades to make controls legible against any frame.
- **No patterns, no textures, no illustrations.** Flat `#0A0A0A` everywhere else.
- **No full-bleed marketing imagery.** The captured photo IS the product imagery — a `aspect-[3/4]` framed shot inside a 24px-radius card. The frame is `bg-black` with a `border-white/10` so a near-black photo doesn't disappear into the page.

### Animation

- **Restrained and short.** All transitions are `200ms` (`transition duration-200`) or `300ms` (`transition-opacity duration-300`).
- **No bounces, no springs.** Standard ease (`cubic-bezier(0.4, 0, 0.2, 1)`).
- **State-driven only.** The reticle fades in when stillness is detected, the Identify button slides up 16px + fades in (`translate-y-4 → translate-y-0, opacity-0 → opacity-100`), helper text auto-fades after 2s via a CSS keyframe. Nothing animates "just because".

### Hover & press

- **Mobile-first means press, not hover.** Cards in `History` show `hover:border-white/20` on pointer devices, but the real feedback is the press state: `active:bg-white/15` on ghost buttons.
- **No scale-shrink presses.** Buttons don't squish — they just shift opacity / background. Primary disabled state is `opacity-45 + pointer-events-none`.
- **Tap targets are `min-h-12` (48px)** universally; primary CTAs are `h-14` (56px).

### Borders & corners

- **Borders are always white-at-low-alpha:** `rgba(255,255,255,0.10)` is the default card stroke, `0.15` for dashed empty-states, `0.20` for hover. Almost never a colored border except on triage cards (amber/red).
- **Radius vocabulary is generous and rounded:**
  - `24px` — the **primary card radius**. Every section card uses it. This is the system's signature shape.
  - `28px` — modal/dialog (one step rounder than cards).
  - `22px` — chat bubble.
  - `20px` — nested sub-cards inside a primary card.
  - `18px` — reticle, thumbnail image.
  - `9999px` — every button, every status chip, every tag. The pill is the second signature.

### Shadows

Two shadows total — that's it:

- `0 12px 40px rgba(255,255,255,0.18)` — the **white-glow under primary CTAs**. This is unusual (white shadow on dark) and visually says "the main action lifts off the surface".
- `0 0 20px rgba(250,204,21,0.30)` — the **yellow halo around the reticle** when active. Reinforces "the camera is locked on".

Cards do **not** have shadows. Depth comes from the border-stroke + background-step pattern.

### Transparency & blur

- `backdrop-blur-md` is used on:
  - Header pill buttons over the camera feed (`bg-black/35 + backdrop-blur-md`)
  - The helper-text tooltip below the reticle
  - The ghost-variant button (`bg-white/10 + backdrop-blur-md`)
  - Modal scrims (`bg-black/72 + backdrop-blur-md`)
- Transparency is the **primary way Deep Spec layers UI over the camera feed.** Solid surfaces would break the "I am looking through a viewfinder" feeling.

### Iconography presence

**There are no decorative icons in the product today.** A bold "DS" monogram appears once in the motion-permission modal (`grid place-items-center` inside a yellow-tinted square). The error-state shows a literal `!` character inside a red square. That's it. See `ICONOGRAPHY` below.

### Layout rules

- **Mobile portrait is the canvas.** Everything is designed for ~390px–428px wide × 100dvh tall.
- **`max-w-md` (448px) is the absolute upper bound** — even in a desktop browser the app sits as a 448px column. There is no desktop layout.
- **Fixed elements:** header is `fixed top-0`, primary CTA is `fixed bottom-0` with safe-area inset. Scanner screen uses these heavily; result/history screens use normal flow with the content scrolling between unfixed bars.
- **Buttons stretch full width** inside cards (`w-full`), or sit in `grid grid-cols-2 gap-3` pairs (Helpful/Wrong, Share/Export).

### Imagery vibe

The only imagery in the product is the user's own photo of a car part. Captured frames are JPEGs (`screenshotQuality={0.92}`) shown `object-contain` inside a `border-white/10 bg-black` frame — preserving aspect, not cropping. **Warm, cool, b&w, grain — irrelevant; whatever the user shoots is what shows.** The empty-state placeholder is a dashed-border tile saying `No captured frame yet.`

---

## ICONOGRAPHY

**Deep Spec uses almost no iconography in the UI.** This is a deliberate stance — the app is a camera with text, and the brand identity is carried by the *brand mark* (the hex-bolt-and-lens app icon), not by inline glyphs.

### What exists

- **App icon (`assets/deepspec-app-icon.png`, `icon-192.png`, `icon-512.png`)** — a dark squircle with a metallic hexagonal bolt-frame surrounding a glossy camera lens, set inside an animated cyan focus-bracket reticle. This icon is the visual logo of the brand; the in-app wordmark is a textual `DEEP SPEC` set in extrabold uppercase Inter with `tracking-[0.18em]`.
- **Reticle bracket marks** (`scanner-corner-tl/tr/bl/br` in `colors_and_type.css` and the original `src/styles/index.css`) — pure CSS, four corners of `border-top-width: 3px` etc. with `border-radius` and a yellow glow filter. These ARE the brand's most recognizable in-app graphic.
- **The `!` glyph** (literally the character `!`) inside a red-tinted square — Camera-Blocked error.
- **`DS` monogram** in the motion-permission modal — pure text, not an SVG.

### What is NOT used

- No icon font (no Lucide, Heroicons, Material Icons, FontAwesome).
- No SVG icons in any component.
- No emoji anywhere in copy or UI.
- No unicode "decorative" characters (no `→`, no `•` as a bullet, no `✓`).

### When you need an icon

For an extension surface (settings menu, marketing site, new features), use **[Lucide](https://lucide.dev) `1.5px` stroke weight, currentColor**. Lucide's outline-only, even-weight style matches Deep Spec's restraint and never competes with brand yellow. Substituted from CDN: `https://unpkg.com/lucide@latest`. **This is a flagged substitution** — no icons exist in the source codebase, so any future iconography needs an explicit design decision.

### Logos & marks in `assets/`

| File | Use |
|---|---|
| `deepspec-app-icon.png` | The 1024×1024 marketing/app-store icon. Dark backgrounds only. |
| `icon-192.png` | PWA install icon, 192². Has built-in safe area for adaptive masks. |
| `icon-512.png` | PWA install icon, 512². |

---

## FONT SUBSTITUTION FLAG

> **Inter is loaded from Google Fonts via CDN in the source repo** (`index.html` `<link rel="stylesheet">`). No `.ttf`/`.woff2` files are bundled. This design system continues that pattern — `fonts/README.md` documents the import. If you need offline fonts, download Inter Variable from [rsms.me/inter](https://rsms.me/inter/) and drop the `.woff2` files into `fonts/`.

---

## SKILL.md (cross-tool use)

A companion `SKILL.md` lives at the root and makes this system invocable as an Agent Skill (Claude Code-compatible). It points the assistant at this README and the UI kit, and instructs it to act as a Deep Spec brand expert when producing artifacts.

---

## How to use this system

1. **Read this README** in full — it's short on purpose.
2. **Import `colors_and_type.css`** in any HTML artifact you build. Reference tokens via `var(--ds-…)`.
3. **Lift components** from `ui_kits/scanner-pwa/` — they're factored as small React/JSX files you can copy into a project.
4. **Match the voice.** Read CONTENT FUNDAMENTALS before writing strings. If you would put an exclamation point or an emoji, you are wrong about Deep Spec.
5. **Stay mobile.** Even if you're making a slide or a webpage, the product itself is `max-w-md`. Show it inside a phone frame.
