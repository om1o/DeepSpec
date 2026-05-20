---
name: deepspec-design
description: Use this skill to generate well-branded interfaces and assets for Deep Spec, the mobile-first AI car-part scanner — either for production or throwaway prototypes / mocks / decks. Contains essential design guidelines, brand colors, typography, fonts, assets, and a full-fidelity React UI kit recreating the live PWA.
user-invocable: true
---

# Deep Spec Design Skill

You are a design expert for **Deep Spec** — a mobile-first, camera-first AI car-part identifier with a safety-first voice. Read `README.md` in this skill folder for the full system; it is the source of truth.

## Quick orientation

- **Mood:** "the mechanical professional." Dark-ops camera tool, never consumer-pastel. Pure black `#0A0A0A`, scanner-yellow `#FACC15`, traffic-light triage colors. Inter ExtraBold (800) carries every heading.
- **Format:** mobile portrait `max-w-md` (448px). No desktop variant — even on a laptop, the app sits in a 448px column.
- **Voice:** short, declarative, slightly nerdy. No emoji, no exclamation points, no Title Case. Sentence-case body + UPPERCASE eyebrows (`tracking-[0.14em]`).

## What's in this skill

| File | Use |
|---|---|
| `README.md` | Full design system — content fundamentals, visual foundations, iconography, voice examples. Read first. |
| `colors_and_type.css` | All foundation tokens as CSS custom properties + utility classes. Import as a stylesheet. |
| `assets/` | App icon, PWA icons. |
| `fonts/README.md` | How Inter is loaded; how to swap to local files. |
| `preview/*.html` | Per-token visual specimens — useful as cut-and-paste reference snippets. |
| `ui_kits/scanner-pwa/` | High-fidelity React recreation of all five live screens. Lift components from here. |
| `Deep Spec Scanner — 3 States.html` | Hi-fi 3-state mockup (Scanning / Analyzing / Result) — a Google-Lens-style drawer variation of the live product. |

## How to use this skill

1. **Read `README.md`** in full — short on purpose. The CONTENT FUNDAMENTALS section is mandatory before writing any strings.
2. If the user is producing a **visual artifact** (a slide, a marketing mock, a throwaway prototype):
   - Copy `colors_and_type.css` and the icons you need into the artifact's project.
   - Reference `var(--ds-*)` tokens or copy the inline Tailwind classes directly from `ui_kits/scanner-pwa/components/`.
   - Wrap mobile work in a phone frame — the product is mobile-only, so showing it in a phone bezel is the correct framing 95% of the time.
3. If the user is working on **production code**: read the README and the JSX components in `ui_kits/scanner-pwa/components/` to absorb the patterns. Then write idiomatic Tailwind v4 (the live repo's stack) — `bg-[#171717]`, `rounded-[24px]`, `border-white/10`, `font-extrabold`, `tracking-tight` are the muscle memory.
4. **Ask the user what they want** if invoked with no other guidance. Useful starter questions:
   - Are we extending the existing PWA, designing a new surface (marketing site, settings, share page), or making a deck?
   - Is this a high-fidelity mock or a quick exploration?
   - Do you want variations? On what dimension — layout, color treatment, copy tone, interaction?

## Hard rules — never break these

- **No emoji. No decorative unicode glyphs (no `→`, no `•` bullets, no `✓`).** Status is signalled by color + a short word.
- **No exclamation points.** Confidence comes from terseness.
- **No Title Case** in UI strings. Sentence-case bodies, UPPERCASE eyebrows.
- **No gradients as decoration.** The only gradient in the system is the camera-feed scrim (`linear-gradient(to bottom, rgba(0,0,0,0.52), rgba(0,0,0,0) 28%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.62))`).
- **Yellow `#FACC15` is rationed.** Only for: reticle, the wordmark, eyebrow ink on cards, input focus border. Never as a background fill.
- **Cards do not have shadows.** Depth = border + background step.
- **Two shadows total exist:** the white-glow under primary CTAs and the yellow halo on the active reticle.
- **Every tap target is `min-h-12` (48px) or larger.** Primary CTAs are `h-14` (56px).
- **Cards radius `24px`. Buttons radius `9999px`.** These two radii are the system signature.
- **Hover/press feedback is opacity + background shift, never scale-shrink.** Mobile-first means press, not hover.

## Defaults when in doubt

| Question | Answer |
|---|---|
| What font? | Inter, ExtraBold (800) for headings, Medium (500) for body. |
| What background? | `#0A0A0A`. Cards on top: `#171717`. |
| What accent? | `#FACC15` — and only for the four uses above. |
| What icon library? | **None used in the source.** If you must, use Lucide outline @ 1.5px stroke and **flag it as a substitution**. |
| Mobile or desktop? | Mobile. Always. `max-w-md mx-auto`. |
| What button shape? | Pill (`rounded-full`). |
| What card shape? | `rounded-[24px]` with `border border-white/10`. |
