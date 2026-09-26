# Remotion Storyboard: DeepSpec Auto Engineer Ad

## Executive Summary

Use this if the static ad needs to become a React/Remotion render. The current repo does not contain a Remotion project, so this is a production-ready storyboard rather than an installed video package.

## Composition

- Name: `DeepSpecEngineerAd`
- Duration: 26 seconds
- Size: 1920 x 1080
- FPS: 30
- Style: graphite engineer panel, cyan visual evidence, green Polar sandbox proof

## Scenes

1. 0-8s: Product promise
   - Headline: `AI-assisted scan evidence for engineers and shop teams.`
   - Support: `Not magic diagnosis. A cleaner way to lock onto the visible target, show confidence, and ask for the next proof.`

2. 8-16s: Visual Evidence AR
   - Show phone-like scanner frame.
   - Show context outline, primary target box, `Grounded` label, confidence range, and next evidence.
   - Keep only one primary target box; evidence chips are not fake spatial boxes.

3. 16-26s: Polar sandbox proof
   - Show four proof cells: `Checkout`, `Webhook`, `Entitlement`, `Portal`.
   - End copy: `Live payments stay off until Dad completes provider setup and the release gates pass.`

## Remotion Implementation Notes

- Use `spring()` or `interpolate()` for text and panel entries.
- Use `Sequence` for the three scenes and a shared transition overlay between scenes.
- Do not add fake screenshots or invented shop/customer logos.
- Keep the disclaimer visible in the final scene:
  `AI-assisted workflow. Not a guaranteed diagnosis, OEM fitment source, or physical measurement tool.`
