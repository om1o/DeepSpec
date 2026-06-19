# DeepSpec Billing Provider Decision

Date: 2026-06-19

## Executive Summary

Do not turn on live paid checkout yet.

DeepSpec should let Dad set up a provider account and sandbox now, but production charges must stay disabled until the identify release gate and provider webhook-to-entitlement flow pass. The product is not ready for live shop billing while `npm run eval:identify:release` is blocked by AI provider availability.

Recommended provider path:

1. **First production Merchant of Record choice: Polar Starter.**
   Use this if Dad wants a developer-first setup, clear public pricing, subscriptions, checkout, webhooks, and less tax/compliance admin than Stripe-only.
2. **Fallback Merchant of Record: Lemon Squeezy.**
   Use this if Dad wants the simplest seller dashboard and checkout setup, and accepts higher/add-on fees for subscriptions, PayPal, and international transactions.
3. **Later enterprise option: Paddle.**
   Use this when DeepSpec has real B2B traction and needs stronger global SaaS billing, invoicing, buyer support, and larger-company motions.
4. **Fastest current code path: Stripe sandbox only.**
   Stripe has the current adapter in this repo, so it is fastest for sandbox checkout testing, but Stripe is not the low-admin Merchant of Record path and should not be the default answer if Dad wants tax/compliance handled for a small team.

## Current Repo State

The repo now has provider-neutral billing fields and fail-closed behavior:

- `BILLING_PROVIDER=` defaults to unconfigured.
- `/api/billing-checkout` and related endpoints fail closed unless a provider adapter is configured.
- The only implemented adapter today is the Stripe adapter.
- Supabase entitlement rows now include generic provider IDs:
  - `billing_provider`
  - `provider_customer_id`
  - `provider_subscription_id`
  - `provider_checkout_id`
- Scan credits reserve before identify and only consume after provider success when `DEEPSPEC_ENFORCE_SCAN_CREDITS=true`.

This means the architecture is ready for Lemon Squeezy, Polar, Paddle, or Stripe, but the next implementation step depends on which provider Dad picks.

## Comparison

| Provider | Current Fit | Pricing / Fees | Strengths | Weaknesses | DeepSpec Recommendation |
| --- | --- | --- | --- | --- | --- |
| Polar | Best first MoR fit for developer-led beta | Starter is publicly listed at 5% + 50c; paid plans lower variable fees at higher monthly revenue | Developer-first API, checkout, subscription/customer state, MoR model, transparent pricing | Newer than Paddle/Stripe; still needs a new adapter in this repo | Pick first if Dad is okay with a developer-oriented dashboard |
| Lemon Squeezy | Best simple-dashboard fallback | Public pricing says 5% + 50c, with add-ons such as subscription, PayPal, and international fees | Simple MoR positioning, subscriptions, software/digital product focus, easy seller flow | Fees can stack; less ideal for larger B2B/enterprise workflows | Pick if Dad wants the easiest operational dashboard |
| Paddle | Best later B2B/global scale option | Public pay-as-you-go pricing is 5% + 50c, with custom pricing for scale | MoR, SaaS subscriptions, tax/compliance, fraud, buyer support, invoicing, enterprise credibility | More heavyweight; may require more verification/review; overkill for first small-shop beta | Revisit after paid beta traction |
| Stripe | Best current-code sandbox path | US card pricing is commonly 2.9% + 30c; Billing adds 0.7% pay-as-you-go for subscription billing volume | Mature engineering docs, current adapter exists, strong Checkout/Portal/Webhooks | Not Merchant of Record; tax/compliance/admin burden stays with the business unless extra products/processes are added | Use sandbox now only if speed matters more than MoR simplicity |

## Why Merchant Of Record First

DeepSpec is trying to sell a software workflow to small repair shops. A Merchant of Record provider is attractive because it handles more of the global tax/compliance/payment administration. That matters because the team is small, Dad is helping set up business/payment operations, and the product needs to focus on mechanic value instead of tax operations.

Stripe is still excellent engineering infrastructure, but it is not the easiest "kid can help operate it without knowing every compliance detail" option. It requires more business, tax, disputes, and payment operations work from the DeepSpec side.

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
- Provider-specific adapter work is still needed if Dad picks Polar, Lemon Squeezy, or Paddle.
- Live payments should remain fail-closed until scan credits, refunds, webhook replay, account portal, and provider outage behavior are verified.

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
- Stripe pricing and Billing pricing document card fees, Checkout/Portal/Billing capabilities, and Billing's 0.7% pay-as-you-go fee: https://stripe.com/pricing and https://stripe.com/billing/pricing
