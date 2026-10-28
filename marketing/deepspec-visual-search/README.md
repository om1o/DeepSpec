# DeepSpec visual-search landing page

A buildless static landing page. White is the primary brand; blue glass is reserved for the intro and sign-in handoff. The flat-white logo uses crisp source-traced vector paths; blue-glass accents preserve the original material.

## Run locally

```sh
python -m http.server 8765 --directory dist
```

Open http://localhost:8765. No package installation or backend keys are required.

## Update assets

Edit `dist/index.html`, `dist/styles.css`, `dist/intro.js`, or `dist/signin.js` / `dist/signin.css` / `dist/micro.js` / `dist/micro.css`, then run:

```sh
python package-static.py
```

This fingerprints CSS and scripts so updated files load together. Commit the resulting source and generated files.

## Demo behavior

The intro autoplays an illustrative scan and predetermined example AI review. The visible scan line sweeps downward before the review and repeats each cycle. Reduced motion keeps the phone and photo still while a softer scan line autoplays. Pause freezes the text and motion; Replay restarts them. No AI endpoint is called.

Normal sign-in clicks run a brief cancellable blue-glass transition, then open the link destination. Modified clicks retain normal browser behavior. Sign-in uses the verified V1 preview URL until a production app domain is confirmed.

See `SOURCES.md` and `brand-assets.md` for references and brand rules. No credentials, Sites project identity, private user data, or local QA artifacts are included.

Verified sign-in destination: https://deepspec-7tfvm2171-deep-spec-team.vercel.app/auth (branding/auth commit ffe0a592c6849145858c0720d5bfba9a2beff9a4).

The visible scan now includes a restrained camera settle, focus lock and result confirmation. Other sections have subtle scroll, hover, press and focus responses. The hero includes a public `/demo` link for sample scans, authored reviews and browser-local saves without signing in. The normal app remains authenticated.
