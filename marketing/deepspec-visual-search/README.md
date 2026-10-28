# DeepSpec visual-search landing page

A buildless static landing page. White is the primary brand; blue glass is reserved for the intro and sign-in handoff. Logo variants use transparent, source-preserving SVGs.

## Run locally

```sh
python -m http.server 8765 --directory dist
```

Open http://localhost:8765. No package installation or backend keys are required.

## Update assets

Edit `dist/index.html`, `dist/styles.css`, `dist/intro.js`, or `dist/signin.js` / `dist/signin.css`, then run:

```sh
python package-static.py
```

This fingerprints CSS and scripts so updated files load together. Commit the resulting source and generated files.

## Demo behavior

The intro autoplays an illustrative scan and predetermined example AI review. The visible scan line sweeps downward before the review and repeats each cycle. Reduced motion keeps the phone and photo still while a softer scan line autoplays. Pause freezes the text and motion; Replay restarts them. No AI endpoint is called.

Normal sign-in clicks run a brief cancellable blue-glass transition, then open the link destination. Modified clicks retain normal browser behavior. Sign-in uses the verified V1 preview URL until a production app domain is confirmed.

See `SOURCES.md` and `brand-assets.md` for references and brand rules. No credentials, Sites project identity, private user data, or local QA artifacts are included.

Verified sign-in destination: https://deepspec-7fxpiw11g-deep-spec-team.vercel.app/auth (branding/auth commit 40b1843b7550ebaed79f6bf5bda5ba85a4e605a3).
