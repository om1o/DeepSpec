# Dad Phone And Paid Beta Release

## Executive Summary

DeepSpec may continue to controlled Dad-phone testing only after the app has a public HTTPS preview URL and the phone-sized website QA suite passes against that URL.

DeepSpec must not start paid beta or live sales until real phone QA, Stripe sandbox, Supabase, identify release, billing evidence, and paid-launch readiness all pass. Local desktop QA is useful evidence, but it is not a substitute for a physical phone camera test.

## Dad Phone Preview Gate

1. Deploy a Vercel Preview, not production.
2. Configure preview environment variables in Vercel, then redeploy.
3. Use the resulting `https://...vercel.app` URL for phone QA.
4. Run:

```bash
npm run check
npm run test:website -- --url <preview-url> --headless --viewport phone
$env:QA_BASE_URL="<preview-url>"; npm run qa:phone-card
npm run verify:dad-phone-paid-beta -- --target dad-test --url <preview-url>
```

Dad should use the generated phone card to test camera permission, live preview, real part scan, AR placement, result detail, history, chat, and upload from the phone photo library.

## Stripe Sandbox Gate

Dad owns the Stripe account, legal business details, bank/tax setup, production keys, refunds, and disputes. Keep `DEEPSPEC_ENABLE_LIVE_BILLING=false` for sandbox.

Required server-only preview variables:

- `BILLING_PROVIDER=stripe`
- `DEEPSPEC_PUBLIC_URL=<preview-url>`
- `STRIPE_SECRET_KEY=<sk_test_...>`
- `STRIPE_WEBHOOK_SECRET=<whsec_...>`
- `STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY=<price_...>`
- `STRIPE_PRICE_DEEPSPEC_PLUS_YEARLY=<price_...>`
- `STRIPE_PRICE_DEEPSPEC_SCAN_PACK=<price_...>`
- `STRIPE_PRICE_DEEPSPEC_PRO_BETA=<price_...>`

Run after Dad creates test products and webhook config:

```bash
npm run verify:billing-provider -- --provider stripe
npm run verify:billing-provider -- --provider stripe --network
npm run verify:billing-checkout -- --provider stripe --url <preview-url> --plan scan_pack
npm run verify:billing-webhook-replay -- --provider stripe --url <preview-url> --plan scan_pack
npm run verify:billing-sandbox-readiness -- --provider stripe
```

## Paid Beta Gate

Paid beta needs all of these:

- Real phone QA grade is at least 8/10 with screenshots or written evidence.
- `npm run verify:supabase` passes on the hosted project.
- `npm run eval:identify:provider-health` passes.
- `npm run eval:identify:hf-health` passes if HF/OpenRouter fallback is enabled.
- `npm run eval:identify:release` passes the fixed 50-case release gate.
- `npm run identify:evidence` reports live identify ready.
- `npm run billing:evidence -- --provider stripe` reports sandbox evidence ready.
- `npm run verify:dad-phone-paid-beta -- --target paid-beta --url <preview-url> --phone-grade <grade>` passes.
- `npm run verify:paid-launch-readiness -- --target live` passes before any live charging.

## GitHub Tracker

- [#115](https://github.com/om1o/DeepSpec/issues/115): Dad phone QA preview and real-camera evidence.
- [#116](https://github.com/om1o/DeepSpec/issues/116): Stripe sandbox keys, prices, checkout, webhook replay, and portal evidence.
- [#117](https://github.com/om1o/DeepSpec/issues/117): AI provider availability and release eval.
- [#118](https://github.com/om1o/DeepSpec/issues/118): Final paid-beta go/no-go evidence.

## Creative Assets

Use verified screenshots and QA reports only. Marketing and demo copy must say "AI-assisted scan and mechanic verification workflow." Do not claim guaranteed diagnosis, perfect AI, mechanic certification, fake shop endorsements, or unsupported accuracy numbers.
