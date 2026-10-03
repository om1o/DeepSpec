# DeepSpec free SEO workbench

DeepSpec does not need a fake SEMrush clone for V1. A free workflow can cover the highest-value work now: technical crawl checks, Search Console data, useful pages, and interviews that produce the language real users search for.

## Run the audit

Build and serve the production site, then audit every URL in `sitemap.xml`:

```bash
npm run build
npm run qa:serve-production
npm run seo:audit -- --url http://localhost:4174
```

The command writes `report.md` and `report.json` under `artifacts/seo/<timestamp>/`. It fails on broken pages, missing titles or descriptions, `noindex`, missing canonicals, invalid JSON-LD, duplicate metadata, or an invalid H1 count. Short copy and missing social metadata are warnings.

Use Google Search Console after the production domain is verified. It supplies real impressions, queries, pages, countries, devices, and indexing status for free. The local audit does not invent keyword volume, backlink counts, or competitor traffic estimates.

## Free tool stack

| Tool | Cost and license | Use now |
| --- | --- | --- |
| DeepSpec `seo:audit` | Project code | Required canonical, metadata, JSON-LD, H1, crawlability, and duplicate gate |
| SEOnaut | Free hosted tier for a small site; open-source MIT project | Crawl the stable production URL after launch |
| SiteOne Crawler | Free MIT binary | Weekly and pre-deployment technical, accessibility, performance, and broken-link report |
| Google Search Console | Free Google service | Indexing, real search queries, impressions, and submitted sitemap |
| OpenSEO | MIT application, but external keyword/backlink data requires paid DataForSEO usage | Do not install until revenue justifies its data cost |

Install SiteOne Crawler separately from its official release page, then run:

```bash
npm run seo:siteone -- --url https://<project>.vercel.app
```

Set `SITEONE_CRAWLER_BIN` when the binary is not on `PATH`. The wrapper enables the crawler's CI gate and browser rendering and writes local HTML, JSON, and text reports under `artifacts/seo/`; it does not enable paid AI features.

Create a Search Console URL-prefix property for the exact stable Vercel production URL and submit `https://<project>.vercel.app/sitemap.xml`. Branch and commit preview URLs are test environments, not separate Search Console properties.

## Weekly 30-minute routine

1. Run `npm run seo:audit` against production and fix new errors.
2. Export the last 28 days from Search Console.
3. Keep queries with impressions and weak clicks; improve the page that already ranks before creating another page.
4. Turn repeated tester or interview wording into one useful article, FAQ, or comparison.
5. Add the page to `sitemap.xml`, link it from one existing article, and rerun the audit.
6. Record the publish date, target question, and Search Console change after four weeks.

Before each release, also run:

```bash
npm run verify:deployment-indexing -- --production https://<project>.vercel.app --preview https://<preview>.vercel.app
```

The production URL must not send `X-Robots-Tag: noindex`; the preview URL must send it.

## Initial content lanes

| Audience | Search question | Honest DeepSpec angle |
| --- | --- | --- |
| DIY owner | What car part is this? | Probable identity, visible evidence, uncertainty, and the next photo |
| Trainee | How do I identify engine-bay parts? | A teaching record, not a replacement for a service manual |
| Parts seller | How can I document unknown car parts? | Photo, result, correction, notes, and sources in one record |
| Used-car buyer | Can AI identify visible car damage? | Visible concern triage with explicit limits on hidden condition and safety |
| Shop advisor | How do I explain a car part to a customer? | A cautious explanation that can be reviewed before sharing |

Do not publish thin pages for every part name. One strong page should answer a real job, include examples, state limitations, and link to the scanner or a relevant guide.
