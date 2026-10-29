# DeepSpec revision sources

- Design and composition reference: https://search.google/ways-to-search/lens/ (inspected 2026-10-27). Split hero, phone demonstration, alternating media sections, centered question panel, device section, more-ways grid.
- Generated car-park hero is an image edit of the original `https://search.google/static/images/heroes/park.webp`, preserving the tree canopy, sky and curving ground composition.
- Generated automotive still life is an image edit of the chair/plant image in the Lens pillow Lottie, retaining its composition and replacing furniture/soft goods with workshop components.
- Generated valve-and-spring macro is an image edit of the source Lens exploration photo, retaining its clustered macro framing.
- The blue-glass intro logo is faithfully recreated from the user's supplied fourth-panel reference. The user subsequently selected WHITE as the main brand mark; the primary logo and app icon use the same geometry in flat white, while blue glass is reserved for the phone intro. GitHub's current assets differ from that chosen identity; no claim that the new variant was downloaded from the repository.
- Product and route evidence: https://github.com/om1o/DeepSpec. Identification from photos, saved scans, follow-up questions, evidence and reports. No accuracy, price, supported-vehicle or fitment claims added.
- Full real-app no-login preview: https://deepspec-git-codex-v1-brand-motion-refresh-deep-spec-team.vercel.app (GitHub app commit acbb3d3bdc1a93effe8fb28d346b68ea97c3c86f). Intro entry buttons open its actual `/scan` route.
- Intro is a clearly labeled illustrative scan animation. Result copy is example content, not a live analysis of a visitor image.
- All logo artwork stays static everywhere; scan animation is confined to the introduction and includes pause, replay and reduced-motion behavior.

## Publication notes

The packaged Sites helper is unavailable in this execution environment. Source sync uses the native Site's scoped repository credential in memory via hidden stdin and an ephemeral Git HTTP authorization header. No credential is stored in source or command arguments. The registered Site identity remains unchanged.

## Coherence and motion correction

The primary white mark and wordmark now use source-traced SVG path outlines with transparent background, preserving the selected geometry and lettering while removing raster scaling and live filters. White remains primary; blue glass remains inside the intro only. The page uses one graphite/steel palette and glossy controls. Intro motion is a synchronized browser animation timeline with real pause/replay; reduced motion keeps the camera and photo still while a gentle downward scan plays automatically. Styles and script references use content hashes so revisions load together.


## Automatic demo and sign-in handoff

The intro automatically runs a thirteen-second illustrative scan and review cycle. The fixed review is authored example copy, revealed word by word after scanning; reduced motion uses a gentle downward scan with a stationary phone and photo, then status changes and a short full-text fade. It performs no runtime AI generation or diagnosis.

The sign-in handoff uses a short cancellable blue-glass transition inspired by Apple's Motion and Materials Human Interface Guidelines (https://developer.apple.com/design/human-interface-guidelines/motion and https://developer.apple.com/design/human-interface-guidelines/materials). It uses original DeepSpec artwork, not Apple assets. Navigation keeps the clicked link destination and works with a short reduced-motion fade. Modified clicks retain normal browser behavior.

White remains the primary app identity. Context-specific transparent SVG lockups and mark-only assets replace opaque pasted logo panels; blue glass is confined to intro and handoff accents.

The entry handoff now opens the real scanner in the no-login preview. The existing camera/upload, analysis, saved scan, report and chat code is reused; the previous sample app is removed.

## Motion and testing polish

The scan uses a small camera settle, brief photo focus, bracket acquisition and a restrained result confirmation. The downward beam and authored review remain synchronized and support pause/replay, lifecycle handling and reduced camera motion. Other sections use one-shot entrance effects and short hover/focus/press feedback; content remains visible without JavaScript and reduced motion skips decorative movement.

The no-login preview uses the full real GitHub app with browser-local scan state and live identify/chat endpoints. Production account access remains separate.

The shared Sites page is public. All app entry links open the real scanner without the email/code screen. The intro phone still illustrates the authored review requested for the landing animation; the opened app analyzes the visitor’s own camera or uploaded image.

Live verification: a real uploaded engine photo reaches `/api/identify` without Authorization. The distributed guest quota connection passes. Image analysis currently returns `not_configured` because Vercel Preview lacks `GEMINI_API_KEY`; no sample answer is substituted. The actual photo remains in browser-local history and opens after reload. The stable branch URL follows successful redeployments.
