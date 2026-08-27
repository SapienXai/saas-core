# Paddle billing setup

Reservevia keeps Paddle as the financial and subscription authority. The database projection is used for fast UI and entitlement decisions only after verified provider synchronization.

## Required environment values

Set these separately for sandbox and production deployments:

- `PADDLE_ENVIRONMENT=sandbox` or `live`
- `PADDLE_API_KEY` (server-only)
- `PADDLE_WEBHOOK_SECRET` for the notification destination
- `CRON_SECRET` for the protected billing lifecycle route and scheduled grace-period expiry
- `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` using the matching `test_` or `live_` client token

Never expose `PADDLE_API_KEY` or `PADDLE_WEBHOOK_SECRET` to the browser.

## Products and prices

Create or verify one recurring Paddle product for each paid Reservevia plan:

- `starter`
- `pro`
- `business`

Create the monthly and annual recurring price for every interval you intend to sell. The price interval and currency must match the mapping row; all subscription items must use the same billing interval.

Do not copy product or price IDs into source code. Register each dashboard value with the server-controlled mapping command:

```bash
npm run billing:register-price -- <starter|pro|business> <sandbox|live> <product-id> <price-id> <month|year> <ISO-currency>
```

For live registration, explicitly set `BILLING_ALLOW_LIVE_PRICE_REGISTRATION=true` for the command. The command retires only the previous mapping for the same plan, interval, and currency.

The application reads the provider price amount from Paddle for display and confirmation. The local `plans.monthly_price_usd_cents` values remain the entitlement/marketing fallback and are never used for provider proration.

## Notification destination

Create one Paddle notification destination per environment:

```text
POST https://<Reservevia-host>/api/billing/paddle/webhook
```

Use the generated destination secret as `PADDLE_WEBHOOK_SECRET`.

Enable these event types:

- `subscription.created`
- `subscription.activated`
- `subscription.trialing`
- `subscription.updated`
- `subscription.past_due`
- `subscription.paused`
- `subscription.resumed`
- `subscription.canceled`
- `transaction.created`
- `transaction.ready`
- `transaction.paid`
- `transaction.billed`
- `transaction.completed`
- `transaction.updated`
- `transaction.past_due`
- `transaction.payment_failed`
- `transaction.canceled`
- `payment_method.saved`
- `payment_method.deleted`

The endpoint verifies the raw request body with the official Paddle SDK before storing the event. Duplicate and out-of-order events are safe to retry.

## API access and portal

Use a Paddle API key with the minimum permissions required by the server calls:

- Read and update subscriptions
- Create customer portal sessions
- Read customers and payment methods
- Read transactions and invoice PDFs
- Create checkout transactions

Enable the Paddle customer portal for the same environment. The portal is used for secure payment-method updates and as a safe provider fallback; Reservevia never stores raw payment credentials.

If using Paddle Retain/Payment Recovery, configure its retry and terminal subscription behavior in Paddle. Reservevia projects the first verified `past_due` event into a 14-day local recovery window: paid access remains active during that window, recovery is opened through Paddle, and the workspace moves to Free after the window if payment has not recovered. The hourly `/api/cron/billing/lifecycle` route persists that expiry; the database quota trigger also fails closed to Free if the worker is delayed.

## Deployment order

1. Apply migrations, including `20260817090000_billing_lifecycle_projection.sql` and `20260818100000_subscription_lifecycle_and_calendar_quota.sql`.
2. Register sandbox product/price mappings.
3. Configure sandbox environment values and notification destination.
4. Test checkout, delayed webhook, upgrade, downgrade, cancellation, reactivation, payment recovery, and invoice access.
5. Register production mappings and configure production environment values.
6. Configure the production notification destination and run the reconciliation command for migrated subscribers.
7. Configure `CRON_SECRET` in the deployment environment and verify the hourly Vercel cron reaches `/api/cron/billing/lifecycle`.

For a subscriber whose local projection is stale:

```bash
BILLING_ALLOW_LIVE_RECONCILE=true npm run billing:reconcile -- <workspace-slug>
```

Arbitrary browser-supplied Paddle IDs, amounts, currencies, and proration modes are rejected by the server action layer.

## Supported scheduling behavior

Paddle-native scheduled cancellation and resumption are used where supported. Paddle’s installed API does not provide a native scheduled product/price replacement, so a downgrade stores a local entitlement-effective timestamp while Paddle remains the source of the next financial price. Reservevia preserves current access until that timestamp and exposes Undo change while the provider update is still reversible.
