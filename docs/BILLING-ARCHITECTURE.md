# Reusable billing architecture

SaaS Core treats billing as a provider-backed projection of a product-owned
catalog. The provider is authoritative for financial events. Core is
authoritative for the verified local subscription projection and the
entitlements derived from it. A browser callback, stale event, or unknown
provider result cannot grant paid access.

## Contract boundary

`packages/core/src/billing.ts` contains only pure types and deterministic
helpers. It has no Next.js, Supabase, network, provider SDK, secret, or
product-domain import. Its vocabulary is:

- status: `active`, `trialing`, `past_due`, `paused`, and `canceled`;
- interval: `month` and `year`;
- transition kinds: checkout, upgrade, downgrade, interval_change, cancel,
  resume, renewal, and recovery;
- transition states: `pending`, `succeeded`, `failed`, and `unknown`;
- proration semantics: immediate, next-period, or none;
- retry decisions: retry, reconcile, or stop.

`resolveEffectiveBillingPlan` applies the same safe lifecycle rule everywhere:
active and trialing retain the purchased plan; paused and canceled use the
configured fallback; past due retains the purchased plan until its grace
deadline, then uses the fallback. An unknown status returns the fallback.
`resolveBillingRetry` requires reconciliation before a financial retry when
the provider outcome is unknown. `resolveBillingTransition` schedules a
future effective change and rejects invalid, failed, or unknown transitions.

The provider adapter translates provider terminology into this contract. For
example, the adapter may translate its immediate upgrade operation to Core's
`immediate` mode and its deferred downgrade operation to `next_period`. Those
provider details stay under `lib/billing`; they do not appear in Core policy
types.

## Provider selection

Paddle is the default provider for new checkouts. Set
`SAAS_CORE_BILLING_PROVIDER=stripe` explicitly on deployments that use Stripe
for new checkouts. Each provider requires its own configuration and price
mappings.

Management uses the provider and environment recorded on the Workspace
subscription, including cancellation, plan changes, portal access, and
invoices. Checkout returns use the saved checkout's provider and environment.
Keep credentials and webhook delivery configured for each provider with active
subscriptions. For example, after switching new checkouts to Paddle, Stripe
continues renewing its existing subscriptions and Core processes their Stripe
events and cancellation requests. See [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
and [Paddle subscription cancellation](https://developer.paddle.com/api-reference/subscriptions/cancel-subscription/).

A linked Workspace keeps its provider and environment after cancellation.
Core permits a verified replacement of a terminal subscription within that
binding. Moving a linked Workspace to another provider or mode requires a
separate migration. Consumer-owned billing actions control their own provider
routing and need review before changing the checkout setting.

## Paddle

For local Sandbox set `SAAS_CORE_BILLING_MODE=enabled`, `PADDLE_ENVIRONMENT=sandbox`,
`PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, and
`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`. Use a loopback `NEXT_PUBLIC_SITE_URL`
and matching loopback server and public Supabase URLs. For an approved
hosted environment bind `PADDLE_APP_ORIGIN` and `SAAS_CORE_APP_URL` to
the exact HTTPS app origin. Keep server and browser Supabase origins equal.
The billing webhook is `/api/billing/paddle/webhook` and Paddle.js checkout
is `/billing/paddle/checkout`.

Register each selected provider price in `billing_provider_prices` via
privileged consumer tooling after validating its environment, product,
currency, interval, and active state. The existing `billing:register-price`
and `billing:reconcile` operator scripts are Stripe-specific. Paddle
checkout and webhook runtime use the same canonical price registry and
projection as Stripe.

Subscribe the Sandbox destination to `transaction.created`,
`transaction.completed`, `transaction.canceled`, `subscription.updated`,
`subscription.activated`, `subscription.trialing`, `subscription.canceled`,
`subscription.paused`, `subscription.past_due`, and `subscription.resumed`.
Schedule the existing billing lifecycle endpoint and monitor failed receipts.
A Paddle create is issued once per Core mutation. A signed notification can
recover a missing transaction reference from a provider-confirmed API
transaction and its durable Workspace, price, and interval intent. When
Paddle returns no recoverable reference, an operator must investigate the
unknown outcome before clearing the mutation.

The hosted portal link requires a subscription linked to the Workspace's
customer. A Sandbox portal token requires the authenticated owner's
confirmed email to match the provider buyer email. The Live link prompts
the buyer to authenticate with Paddle. Live Checkout defaults to disabled
and configuration tests exercise account binding and an explicit Workspace
pilot gate. Live acceptance requires provider-side checkout, webhooks and
lifecycle evidence. See [Paddle Sandbox](https://developer.paddle.com/sdks/sandbox/)
and [Paddle portal links](https://developer.paddle.com/build/customers/integrate-customer-portal/).

## Deferred provider mode

Set `SAAS_CORE_BILLING_MODE=deferred` when a product intentionally pauses
customer-initiated billing changes. Core blocks Checkout, Portal, and plan
mutation calls while continuing to verify webhooks and reconcile subscriptions.
The product keeps its local plan and entitlement projection. Unset the variable
only for an environment that intentionally enables provider billing; this flag does not change the configured environment.

## Stripe Checkout tax controls

Sandbox Checkout explicitly disables Stripe Managed Payments because test
accounts can inherit an account-level setting that requires a Product tax
classification. Live Checkout omits that override and follows the Stripe
account configuration. Core does not infer Product tax codes or enable
automatic tax; each consumer must establish its merchant registrations and
Product classification before activating those Live settings.

## Product catalog and copy

The existing catalog remains valid:

```ts
const catalog = {
  defaultPlanKey: "workspace",
  plans: [
    {
      key: "workspace",
      name: "Workspace",
      features: { collaboration: true },
      limits: { "core.workspaces": 1, seats: null },
    },
  ],
}
```

Plan keys are product-owned and open-ended within the safe key grammar.
Features, limits, and usage metrics are also product-owned keys. Feature
values are booleans. Limits are non-negative integers or `null`; `null` is an
explicit unlimited value, while an absent key remains unavailable to an
entitlement check. The default plan must exist and must explicitly include
`limits.core.workspaces`, preserving the existing workspace bootstrap
boundary.

Optional billing policy can be added without changing an existing catalog:

```ts
billing: {
  defaultPlanKey: "workspace",
  fallbackPlanKey: "workspace",
  supportedIntervals: ["month", "year"],
  defaultInterval: "month",
  paymentGracePeriodDays: 14,
  proration: { upgrade: "immediate", downgrade: "next_period" },
}
```

`defaultPlanKey` and `fallbackPlanKey`, when supplied, must refer to existing
plans; the policy default must agree with `catalog.defaultPlanKey`. If the
policy is omitted, the catalog default is used as the fallback, the supported
intervals are month and year, and the payment grace period is fourteen days.
Optional `billing.presentation` or `billingPresentation` supplies product
copy without moving it into Core:

```ts
billingPresentation: {
  planOrder: ["workspace"],
  plans: {
    workspace: { description: "A place for your team.", highlights: ["Shared access"] },
  },
  copy: { title: "Choose a plan", recovery: "Update payment details to restore access." },
  comparison: [{ key: "seats", label: "Seats", kind: "limit", limitKey: "seats" }],
}
```

Validation rejects duplicate or unknown plan order entries, unsupported
intervals, malformed prices, empty copy, duplicate comparison keys, and
feature/limit/presentation references that do not exist in the catalog.
Optional fields are additive, so products can adopt them incrementally.

## Runtime ownership and data flow

The runtime keeps the existing projection and journal surface:

```text
product catalog/config
        │
        ▼
server-authorized billing action
        │  resolves workspace, plan, interval, currency, provider mapping
        ▼
provider adapter ── financial operation ── provider
        │                                      │
        │ unknown result                       │ verified event
        ▼                                      ▼
mutation journal / reconciliation       webhook signature boundary
                                               │
                                               ▼
                                    ordered local subscription projection
                                               │
                                               ▼
                                    generic entitlements and product writes
```

`workspace_subscriptions` remains the local entitlement projection.
`billing_provider_prices` remains an environment-scoped mapping from a
product plan and interval to a provider price. Checkout sessions, mutation
journals, and webhook inbox records remain durable operational state. All
financial mutations require the existing server-side workspace-owner
authorization. Provider customer IDs, provider price IDs, environment, and
plan mappings are resolved on the server.

Webhook processing verifies the exact raw body before parsing or persistence,
deduplicates provider event IDs within their provider and environment, and
re-reads the provider under a Workspace projection lease so delayed delivery
cannot apply an older payload. Unknown prices, workspaces, subscriptions, or
environments fail closed. A failed operation may be retried according to its
durable state. An unknown operation result must be reconciled before another
financial call is attempted, because an unavailable response does not prove
that the provider did not apply the operation.

Stripe idempotency keys are stable per provider step and endpoint. A mutation's
subscription metadata marker, schedule release, and end-of-period cancellation
use different keys while retaining the same mutation ID for journal
correlation. Before a new financial action is blocked by an unknown mutation,
Core re-reads a matching provider-linked subscription and reconciles its
authoritative state. It closes the journal only when that state proves success
or non-application; unresolved or uncorrelated outcomes remain blocked.

Checkout confirmation has the same server-authoritative boundary. The
provider's browser completion callback is only a wake-up signal for the UI.
When signed webhook delivery is delayed or unreachable, the managed checkout
action may re-read the exact workspace-scoped transaction and recurring
subscription from the provider, validate its environment, custom data, plan
price, item count, quantity, and active status, and pass those observations
through the same canonical projection used by signed webhooks. Invalid or
incomplete observations fail closed or remain pending; the browser never
grants paid access.

An immediate plan change becomes effective only after the verified provider
event updates the local projection. A deferred downgrade or cancellation
keeps current entitlements through its exact effective timestamp. Past-due access is bounded by the recorded grace deadline and the verified
local paid period. On expiry, effective entitlements fall back and existing
data, usage, and provider history remain available to their owners. Resume clears a scheduled cancellation after provider
confirmation.

A same-plan billing-cycle change uses the same preview, confirmation and
journal as a plan change. Monthly-to-annual is immediate when provider
payment and the resulting billing window can be verified. An annual-to-monthly
transition must preserve the current annual entitlement boundary. Paddle
Sandbox can schedule a pause at that boundary, then stage and resume once
under a durable mutation claim. A completed recurring transaction must
match the customer, subscription, items and billing window before the new
period is granted. A resume with an uncertain result is reconciled through
provider reads and may require operator intervention. Core rejects this
Paddle cutover in Live pending provider certification. See
[Paddle subscription updates](https://developer.paddle.com/api-reference/subscriptions/update-subscription/)
and [Paddle renewal events](https://developer.paddle.com/webhooks/simulator/subscription-renewed/).

For an explicit plan change, the managed action adds one provider-neutral
policy step before the provider mutation:

```text
target plan
  → authoritative target limits
  → authoritative current usage
  → PlanChangeEligibility
  → schedule/provider mutation only when allowed
```

Finite target limits require `current <= targetLimit`; `null` is explicitly
unlimited; missing configuration or unavailable usage fails closed. The check
runs during downgrade preview and is repeated at confirmation immediately
before scheduling or calling the provider. Upgrades do not require target-usage
eligibility. Cancellation is a separate lifecycle operation and remains
available even when a workspace is over fallback limits; existing data is
never silently deleted.

## Product integration boundary

Products provide catalog definitions, prices, feature and limit keys, usage
metrics, the server-only `src/product/usage.ts` resolver registry, plan
presentation, and domain-specific quota writes. The shared Plan action and
`createEntitlementService()` compose that registry with Core's built-in
workspace/member usage; product server actions call `assertCanConsume()` after
resolving the authenticated Workspace. Core does not know what a product's
Workspace contains and does not own product tables, domain entities, marketing
copy, or metrics. For check-then-insert quotas, a product-owned transaction
RPC calls `public.lock_workspace_entitlement()` before its own count and
insert; this keeps policy in Core while keeping domain semantics in the
consumer.

ReserveVia keeps its restaurant, reservation, history, fixed plan ladder,
prices, and legacy custom-data translation in its own migration. PlaceDJ
keeps its venue, device, music, catalog, limits, and copy in its own product
configuration and write boundaries. Both consumers use the shared contract
through an explicit migration and keep their provider IDs and history
intact.

## Phase 1 result and consumer handoff

Phase 1 now delivers the complete reusable Core path:

```text
product catalog
  → normalized workspace subscription
  → effective plan / entitlements
  → authoritative Core or product usage
  → server guard or transactional lock
  → billing and limit-reached UI
```

The configured catalog fallback is used when a paid subscription is absent,
missing its local paid period, past that period, paused, canceled, unknown, or mapped to an inactive plan. `null` is
the only unlimited limit; an omitted or malformed capability is unavailable.
Non-manual paid projections also require a complete local provider identity;
normal entitlement reads use the local projection.

The root migration and application template carry both durable billing
persistence and the server-only entitlement lock boundary. The CLI delivers
those files as source and never applies SQL. Consumers must apply and verify
the migrations in their own controlled database workflow, define their own
commercial catalog/provider mappings, register product usage resolvers, and
guard product mutations. See [BILLING-CONSUMER.md](./BILLING-CONSUMER.md) for
the exact integration contract and [BILLING-PARITY.md](./BILLING-PARITY.md) for
the ReserveVia comparison.
