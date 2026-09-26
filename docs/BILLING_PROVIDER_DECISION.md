# DeepSpec Billing Provider Decision

Date: 2026-06-22

## Executive Summary

Do not turn on live paid checkout yet.

Dad said Stripe is not usable for this release path. DeepSpec should move the Dad paid-beta setup to a provider-neutral billing path with **Polar sandbox as the first provider to verify**. Production charges must stay disabled until the identify release gate and provider webhook-to-entitlement flow pass.

Recommended provider path:

1. **First production Merchant of Record choice: Polar Starter.**
   Use this because Dad cannot use Stripe, Polar is Merchant-of-Record oriented, and this repo already has a Polar adapter path for checkout, webhooks, and customer portal handoff.
2. **Fallback Merchant of Record: Lemon Squeezy.**
   Use this only if Dad cannot get through Polar setup and accepts that DeepSpec will need a new Lemon Squeezy adapter before checkout can be verified.
3. **Later enterprise option: Paddle.**
   Use this when DeepSpec has real B2B traction and needs stronger global SaaS billing, invoicing, buyer support, and larger-company motions.

## Current Repo State

The repo now has provider-neutral billing fields and fail-closed behavior:

- `BILLING_PROVIDER=` defaults to unconfigured.
- `/api/billing-checkout` and related endpoints fail closed unless a provider adapter is configured.
- Implemented adapters in this branch:
  - `polar` for the Dad paid-beta path
  - `stripe` as legacy compatibility only
- Supabase entitlement rows now include generic provider IDs:
  - `billing_provider`
  - `provider_customer_id`
  - `provider_subscription_id`
  - `provider_checkout_id`
- Scan credits reserve before identify and only consume after provider success when `DEEPSPEC_ENFORCE_SCAN_CREDITS=true`.

This means the architecture is provider-neutral, Polar is the first adapter to test in sandbox, and Lemon Squeezy or Paddle can be added later without reshaping entitlement storage.

## Comparison

| Provider | Current Fit | Pricing / Fees | Strengths | Weaknesses | DeepSpec Recommendation |
| --- | --- | --- | --- | --- | --- |
| Polar | Best first MoR fit for developer-led beta | Starter is publicly listed at 5% + 50c; paid plans lower variable fees at higher monthly revenue | Developer-first API, checkout, subscription/customer state, customer portal, MoR model, transparent pricing, current repo adapter path | Dad still must pass provider account review and payout setup | Pick first now |
| Lemon Squeezy | Best simple-dashboard fallback | Public pricing says 5% + 50c, with digital product and subscription features | Simple MoR positioning, subscriptions, software/digital product focus, easy seller flow | Needs a new DeepSpec adapter; fees and terms must be reviewed before implementation | Keep as fallback if Polar is blocked |
| Paddle | Best later B2B/global scale option | Public pay-as-you-go pricing is 5% + 50c, with custom pricing for scale | MoR, SaaS subscriptions, tax/compliance, fraud, buyer support, invoicing, enterprise credibility | More heavyweight; may require more verification/review; overkill for first small-shop beta | Revisit after paid beta traction |

Implementation note: legacy Stripe fields and adapter tests still exist for backward-compatible entitlement data and old branches, but Stripe is removed from the Dad setup checklist and `.env.example`.

## Why Merchant Of Record First

DeepSpec is trying to sell a software workflow to small repair shops. A Merchant of Record provider is attractive because it handles more of the global tax/compliance/payment administration. That matters because the team is small, Dad is helping set up business/payment operations, and the product needs to focus on mechanic value instead of tax operations.

The old direct payment-provider path is not the release path because Dad cannot use it and it leaves more business, tax, disputes, and payment operations work on the DeepSpec side.

## Kid-Safe Operating Rule

No child should be the legal merchant or production key owner.

Dad should create and own the provider account, legal business identity, bank/tax details, production API keys, webhook secrets, and refund/dispute responsibility. A kid can help in sandbox mode, product setup, QA, and support workflows with limited dashboard permissions when the provider supports that.

Practical rule:

- Kid can use test mode and read-only dashboards.
- Dad owns live mode, bank details, tax forms, refunds, disputes, and production keys.
- Production keys stay server-only and never go into `VITE_` variables.

## Start-Now Decision

Start provider setup now:

- Create the provider account.
- Create sandbox products:
  - `DeepSpec Plus Monthly`
  - `DeepSpec Plus Yearly`
  - `Scan Pack`
  - `DeepSpec Pro Beta`
- Configure sandbox webhook endpoint.
- Run checkout -> webhook -> entitlement -> account page tests.

Do not start live charging now:

- `npm run eval:identify:release` is blocked by provider availability.
- Polar still needs Dad's sandbox account, product IDs, webhook secret, and end-to-end sandbox verification.
- Provider-specific adapter work is still needed if Dad later picks Lemon Squeezy or Paddle.
- Live payments should remain fail-closed until scan credits, refunds, webhook replay, account portal, and provider outage behavior are verified.
- The server refuses live provider traffic unless `DEEPSPEC_ENABLE_LIVE_BILLING=true` is intentionally set.

## Polar Sandbox Environment

If Dad picks Polar, configure only server-side environment variables:

- `BILLING_PROVIDER=polar`
- `DEEPSPEC_ENABLE_LIVE_BILLING=false`
- `POLAR_ENVIRONMENT=sandbox`
- `POLAR_ACCESS_TOKEN=<server-only organization access token>`
- `POLAR_WEBHOOK_SECRET=<server-only webhook secret>`
- `POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY=<sandbox product id>`
- `POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY=<sandbox product id>`
- `POLAR_PRODUCT_DEEPSPEC_SCAN_PACK=<sandbox product id>`
- `POLAR_PRODUCT_DEEPSPEC_PRO_BETA=<sandbox product id>`

Do not put Polar access tokens or webhook secrets in `VITE_` variables.
Do not set `DEEPSPEC_ENABLE_LIVE_BILLING=true` during sandbox setup. That flag is the final real-money switch and production provider traffic fails closed without it.
Use `.env.example` as the copy/paste checklist, then paste real sandbox values into `.env.local`.

Before copying real values, print the no-secret setup runbook:

```bash
npm run billing:setup-runbook -- --provider polar
```

Then run:

```bash
npm run verify:billing-provider -- --provider polar
```

After the sandbox products exist and Dad has pasted real sandbox IDs/tokens, run the read-only product lookup:

```bash
npm run verify:billing-provider -- --provider polar --network
```

This verifier does not make a real payment. It checks server-only key placement, required product IDs, webhook-secret format, sandbox-vs-production safety, and optional read-only provider product lookup. Live production checks require an explicit `--allow-production` flag.

After the app server is running with `BILLING_PROVIDER=polar`, verify checkout URL creation:

```bash
npm run verify:billing-checkout -- --url http://127.0.0.1:5175 --plan scan_pack
```

This creates a fresh anonymous Supabase session, calls `/api/billing-checkout`, verifies the provider returned an HTTPS Polar checkout URL, and writes `artifacts/release-gates/billing-checkout-summary.json`. It does not make a payment.

Then replay one signed synthetic sandbox webhook through the real API route:

```bash
npm run verify:billing-webhook-replay -- --url http://127.0.0.1:5175 --plan scan_pack
```

This replay creates a fresh anonymous Supabase user, posts a signed synthetic Polar `order.paid` event to `/api/billing-webhook`, verifies `/api/account-entitlement` returns an active Polar-backed entitlement, verifies `/api/billing-portal` returns an HTTPS Polar customer portal URL from the server-owned entitlement record, and then deletes only that synthetic billing entitlement row. It still does not make a payment.

Then verify provider-only sandbox readiness:

```bash
npm run verify:billing-sandbox-readiness -- --provider polar
```

This command checks billing provider config, checkout evidence, webhook replay evidence, and billing portal handoff evidence. It does not approve live payments and it intentionally does not judge AI identify quality.

Then print the no-secret evidence bundle:

```bash
npm run identify:evidence
npm run billing:evidence -- --provider polar
```

These write no-secret evidence bundles under `artifacts/release-gates/`. Share the markdown results, not real provider keys or dashboard screenshots.

Final go/no-go command:

```bash
npm run verify:paid-launch-readiness -- --target live
```

This command combines billing provider config, identify release summary, billing checkout summary, billing webhook replay plus portal summary, and the latest website QA report. If it fails, the answer is still sandbox only. If it passes, live charging is allowed from a technical gate perspective, subject to Dad owning the legal/business account and production keys.

## Implementation Order After Dad Picks

1. Add provider adapter:
   - `createCheckout`
   - `verifyWebhook`
   - `readEntitlement`
   - `createPortalOrManagementLink`
2. Map provider events to server entitlements:
   - checkout paid
   - subscription active
   - subscription cancelled
   - payment failed
   - refund / dispute
3. Keep scan credits server-side:
   - reserve credit before scan
   - consume only after successful identify response
   - do not consume on provider failure, network failure, or AI provider failure
4. Run required QA:
   - `npm run check`
   - `npm run test:website`
   - `npm run verify:supabase`
   - `npm run eval:identify:release`
   - provider sandbox checkout -> webhook -> entitlement -> portal/account page

## Source Notes

- Lemon Squeezy pricing page lists 5% + 50c and MoR positioning: https://www.lemonsqueezy.com/pricing
- Lemon Squeezy fee docs list extra fees for international, PayPal, and subscription payments: https://docs.lemonsqueezy.com/help/getting-started/fees
- Polar pricing lists Starter at 5% + 50c and paid plans with lower variable rates: https://polar.sh/resources/pricing
- Polar fee docs describe added international card fees, chargeback fees, and MoR chargeback monitoring: https://polar.sh/docs/merchant-of-record/fees
- Paddle pricing lists pay-as-you-go at 5% + 50c and includes tax/compliance, fraud, and billing support: https://www.paddle.com/pricing
- Paddle describes itself as Merchant of Record for digital product businesses across 300+ markets: https://www.paddle.com/
