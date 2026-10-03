# Free-domain launch runbook

The public V1 uses one stable Vercel production URL. Try the project names `deepspec`, `getdeepspec`, then `deepspec-app`. Do not promote a branch or commit preview URL.

## Automated gates

Run these against the exact commit that will be deployed:

```bash
npm ci
npm run check
npm run plugin:test
npm run eval:identify:release
```

`npm run check` includes lint, the full Vitest suite, standalone SEO/tool tests, and the production build. The provider evaluation must complete all 50 fixed cases. An interrupted or rate-limited prefix is not a pass and must not become an accuracy claim.

Live billing remains disabled:

```text
DEEPSPEC_ENABLE_LIVE_BILLING=false
DEEPSPEC_ENFORCE_SCAN_CREDITS=false
```

## Human gates

1. Complete the ten-part family assignment in `V1_TESTER_BRIEF_2026-10-01.md` and retain right, wrong, unsure, failure, and timing observations.
2. On physical iPhone Safari and Android Chrome, test permission allow and deny, live camera, upload, interruption, save, reload, reopen, sign-out, and sign-in.
3. Run `npm run verify:supabase -- --inspection` and retain owner access, cross-account denial, private-image isolation, and fixture-cleanup evidence.
4. Submit feedback from a scan result and confirm the scan link and issue context survive save and reopen.
5. Complete the ChatGPT developer-mode proof in `chatgpt-plugin/README.md` before promoting the integration.

Stop for lost records, cross-account exposure, wrong-object overlays presented as certain, essential mobile controls that cannot be used, or a provider chain that cannot complete the release set.

## Deploy and index

Vercel automatically exposes `VERCEL_PROJECT_PRODUCTION_URL`; the build uses it for canonical tags, Open Graph metadata, JSON-LD, `sitemap.xml`, `robots.txt`, `llms.txt`, plugin metadata, and product links. Explicit URL environment variables override it.

After the stable production deployment exists:

```bash
npm run seo:audit -- --url https://<project>.vercel.app
npm run seo:siteone -- --url https://<project>.vercel.app
npm run verify:deployment-indexing -- --production https://<project>.vercel.app --preview https://<preview>.vercel.app
```

Create a Google Search Console URL-prefix property for the production URL and submit `/sitemap.xml`. Keep previews `noindex`. When a permanent domain is affordable, map each old URL to its exact replacement with a `301` redirect and retain the redirects for at least one year.

## Promotion gate

Start the four-week schedule in `TESTER_INTERVIEW_AND_SOCIAL_PLAN.md` on the first Tuesday after every gate above passes. Do not buy ads until there are at least 20 external test sessions, 40 recorded scans, measured provider cost, and a working feedback loop.
