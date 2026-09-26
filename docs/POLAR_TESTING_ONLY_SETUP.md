# Polar Testing Only Setup

## Executive Summary

Use Polar sandbox only for Dad's paid-beta payment testing. Do not configure Stripe. Do not enable live billing.

The app side is ready to validate a Polar sandbox configuration with:

```bash
npm run verify:polar-testing-only -- --strict-public-url
```

This command fails if:

- `BILLING_PROVIDER` is not `polar`.
- `DEEPSPEC_ENABLE_LIVE_BILLING=true`.
- Any `STRIPE_*` value is present.
- required Polar sandbox token, webhook secret, product IDs, or public URL are missing or malformed.

## Dad Does In Polar

1. Open the Polar sandbox dashboard.
2. Create the sandbox organization.
3. Create four sandbox products:
   - `DeepSpec Auto Plus Monthly`
   - `DeepSpec Auto Plus Yearly`
   - `Scan Pack`
   - `DeepSpec Auto Pro Beta`
4. Create the sandbox organization access token.
5. Create the webhook endpoint for the preview URL:
   - `<preview-url>/api/billing-webhook`
6. Copy only the sandbox values into the server-side preview environment.

## Server Env

```bash
BILLING_PROVIDER=polar
DEEPSPEC_ENABLE_LIVE_BILLING=false
DEEPSPEC_PUBLIC_URL=<preview-url>
POLAR_ENVIRONMENT=sandbox
POLAR_ACCESS_TOKEN=<server-only organization access token>
POLAR_WEBHOOK_SECRET=<server-only webhook secret>
POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY=<sandbox product id>
POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY=<sandbox product id>
POLAR_PRODUCT_DEEPSPEC_SCAN_PACK=<sandbox product id>
POLAR_PRODUCT_DEEPSPEC_PRO_BETA=<sandbox product id>
```

Do not put Polar secrets in `VITE_` variables. Do not put real values in Git.

## Verification Flow

```bash
npm run billing:setup-runbook -- --provider polar
npm run verify:polar-testing-only -- --strict-public-url
npm run verify:billing-provider -- --provider polar --network
npm run verify:billing-checkout -- --provider polar --url <preview-url> --plan scan_pack
npm run verify:billing-webhook-replay -- --provider polar --url <preview-url> --plan scan_pack
npm run verify:billing-sandbox-readiness -- --provider polar
npm run billing:evidence -- --provider polar
```

## Launch Rule

Passing Polar sandbox is not permission to sell live. Live paid beta still needs:

- Dad iPhone test at least 8/10.
- Visual Evidence AR with no phone layout blocker.
- `npm run eval:identify:release` passing.
- `npm run verify:paid-launch-readiness -- --target live` passing.

## Source Notes

- Polar sandbox is isolated from production: https://polar.sh/docs/integrate/sandbox
- Polar API base URLs separate production and sandbox: https://polar.sh/docs/api-reference/introduction
- Polar webhooks follow Standard Webhooks: https://polar.sh/docs/integrate/webhooks/endpoints
- Polar customer portal supports subscription and purchase management: https://polar.sh/docs/features/customer-portal/introduction
