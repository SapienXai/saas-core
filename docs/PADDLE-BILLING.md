# Reservevia Paddle Billing

Phase 4 connects Paddle Billing on top of the existing Reservevia commercial engine. Paddle handles checkout and financial subscription state; `workspace_subscriptions` and `lib/entitlements.ts` remain the application source of truth.

## Sandbox configuration

Use Paddle Sandbox only during development. Copy `.env.example` to `.env.local` and set:

```bash
PADDLE_ENVIRONMENT=sandbox
PADDLE_API_KEY=pdl_sandbox_...
PADDLE_WEBHOOK_SECRET=...
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_...
```

The API key and webhook secret are server-only. The client token is the only Paddle value returned to browser code. The code rejects an invalid environment or a client token whose prefix does not match the configured environment. Live use requires a deliberate separate configuration and is refused by the local registration command.

Paddle Sandbox credentials and IDs were not available during this implementation, so no products, prices, transactions, or live objects were created. Create three monthly recurring Sandbox prices in Paddle:

- Reservevia Starter — $19/month
- Reservevia Pro — $49/month
- Reservevia Business — $99/month

Register each mapping in the isolated local database:

```bash
npm run db:start
npm run db:reset
npm run billing:register-price -- starter sandbox <starter-product-id> <starter-price-id>
npm run billing:register-price -- pro sandbox <pro-product-id> <pro-price-id>
npm run billing:register-price -- business sandbox <business-product-id> <business-price-id>
```

The command is development-only, validates the plan/environment, retires the previous active mapping for that plan, and refuses live or non-local mutation. Free intentionally has no Paddle mapping.

## Provider mapping and local state

`billing_provider_prices` owns provider identity by provider, environment, plan, monthly interval, and USD currency. Plan features and limits remain in `plans`; Paddle product metadata is not duplicated as application authorization logic.

`workspace_subscriptions` retains the existing fields and adds Paddle customer/subscription/price IDs, provider environment/status, provider event ordering, renewal/cancellation state, and a safe billing issue code. A new workspace remains Free with no Paddle customer or subscription. Felix Restaurants remains its seeded Business/system grandfathered state and is not attached to Paddle.

## Checkout

The owner opens `/manage/plan`, selects a paid plan, and calls an owner-only Server Action. The server derives the current workspace from membership, checks that it is Free, resolves the active Sandbox mapping, creates a Paddle transaction with a request idempotency key, and adds `reservevia_workspace_id` and the billing environment as custom data. The browser opens that transaction in Paddle.js Overlay Checkout.

The checkout client event is UX-only. It starts a short refresh loop, but paid access is not granted until a verified subscription webhook updates `workspace_subscriptions`. Abandoned or failed checkout leaves the previous plan unchanged.

## Customer and subscription mapping

The Paddle customer ID is stored against the workspace subscription after a subscription event. The Paddle subscription ID becomes the primary key for subsequent lifecycle events. A workspace cannot be controlled by two active Paddle subscriptions. A canceled subscription may be replaced by a later checkout while old provider identifiers remain in local state until the new subscription is confirmed.

## Webhooks, signature verification, and idempotency

Configure Paddle to send events to:

```text
POST /api/billing/paddle/webhook
```

The route accepts only POST, reads `request.text()` exactly once, and verifies `Paddle-Signature` with the official Node SDK and `PADDLE_WEBHOOK_SECRET` before parsing or trusting the event. It stores a normalized, minimal payload in `billing_webhook_events`, keyed uniquely by `(provider, provider_event_id)`, then schedules durable processing. Raw payment/card data and secrets are not logged or retained.

Processing claims the inbox row, increments attempts, applies subscription state, and marks the event processed/ignored/failed. Failed events can be retried; concurrent processors cannot claim the same received row. `last_provider_event_at` guards the subscription update, so an older event cannot overwrite a newer one. Unknown price IDs, workspaces, subscriptions, or billing environments fail closed and leave entitlements unchanged.

Handled subscription lifecycle events include created, activated, updated, past_due, paused, resumed, and canceled. Transaction completion is recorded as an unsupported/ignored event unless it is later needed for reconciliation; it never grants access by itself.

## Status policy

| Paddle state | Reservevia effective state |
| --- | --- |
| active / trialing | Purchased paid plan |
| past_due | Purchased paid plan retained for 14 days; owner recovery deadline shown |
| payment grace expired | Free entitlements; data and current-month usage retained; paid access can be restored after payment recovery |
| scheduled cancellation | Current paid plan retained until effective date |
| paused | Free entitlements, data retained |
| canceled | Free entitlements; data and provider history retained |

Canceled paid workspaces do not receive a $0 Paddle subscription. New reservations, restaurant creation, user invitations, and history access are governed by the Free entitlement layer after synchronization. No destructive downgrade occurs.

## Plan changes and cancellation

Only workspace owners can start checkout, change plans, cancel, or open Manage Billing. Paid-to-paid changes reuse the current Paddle subscription. The server resolves the target mapping, previews the change, and uses Paddle's explicit proration mode: immediate proration for upgrades and next-billing-period proration for downgrades. Payment failure uses Paddle's `prevent_change` behavior. Local state changes only after the resulting webhook.

Cancellation is submitted for the next billing period. A scheduled cancellation sets the local cancellation indicator when Paddle reports it, and the workspace remains paid until the effective canceled event. Paddle Customer Portal sessions are created fresh, are temporary, and are never persisted as permanent URLs.

## Reconciliation

For a missed webhook or support investigation:

```bash
npm run billing:reconcile -- <workspace-slug>
```

The command requires server-only Supabase and matching Paddle environment variables, refuses live reconciliation unless `BILLING_ALLOW_LIVE_RECONCILE=true`, fetches the current Paddle subscription, resolves its current price through the environment-specific mapping, and updates local state only when the provider timestamp is newer. It never changes Paddle based on local state and is not called during normal restaurant operation.

## Testing boundary

Automated tests cover SDK raw-body signature verification, normalization, status mapping, provider-table RLS, owner-controlled subscription synchronization, out-of-order events, past-due retention, and canceled-to-Free behavior. The local database reset and RLS suite run against Reservevia's isolated Supabase containers.

No real Paddle Sandbox Checkout, webhook simulator, or Customer Portal session was claimed during this implementation because Sandbox credentials and provider IDs were not available. Once configured, validate Free → Starter, Starter → Pro, cancellation scheduling/effective cancellation, and portal access with Paddle Sandbox test instruments.

## Live rollout checklist

Before enabling Paddle Live, create and verify separately:

- approved Paddle Live account and monthly Starter/Pro/Business products/prices
- live API key and client token
- live webhook destination and signing secret
- `billing_provider_prices` rows with `environment=live`
- production Vercel environment variables, with Sandbox values removed
- webhook delivery, duplicate, out-of-order, unknown-price, and cancellation tests
- a controlled live purchase/refund/support plan

Do not mix Sandbox and Live IDs. Do not deploy live billing without checking the provider environment and mapping rows.

Official references: [Paddle Node.js SDK](https://developer.paddle.com/sdks/libraries/node/), [webhook signature verification](https://developer.paddle.com/webhooks/about/signature-verification/), [Paddle.js checkout](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/), [transactions](https://developer.paddle.com/api-reference/transactions/create-transaction/), [subscriptions](https://developer.paddle.com/api-reference/subscriptions/update-subscription/), [proration](https://developer.paddle.com/concepts/subscriptions/proration/), and [Customer Portal sessions](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/).
