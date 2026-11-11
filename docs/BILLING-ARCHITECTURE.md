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

## Deferred provider mode

Set `SAAS_CORE_BILLING_MODE=deferred` when a product intentionally pauses
customer-initiated billing changes. Core blocks Checkout, Portal, and plan
mutation calls while continuing to verify webhooks and reconcile subscriptions.
The product keeps its local plan and entitlement projection. Unset the variable
only for an environment that intentionally enables Stripe Sandbox or Live
billing; this flag does not change the configured environment.

## Stripe Checkout tax controls

Sandbox Checkout explicitly disables Stripe Managed Payments because test
accounts can inherit an account-level setting that requires a Product tax
classification. Live Checkout omits that override and follows the Stripe
account configuration. Core does not infer Product tax codes or enable
automatic tax; each consumer must establish its merchant registrations and
Product classification before activating those Live settings.

## Paddle Sandbox checkout

Set `SAAS_CORE_BILLING_PROVIDER=paddle`, `SAAS_CORE_BILLING_MODE=enabled`,
and `PADDLE_ENVIRONMENT=sandbox`. A development process uses a loopback
application origin and local Supabase URLs. A hosted production process uses
an explicit HTTPS `PADDLE_APP_ORIGIN` matching `APP_URL` and matching HTTPS
Supabase URLs. Supply a Sandbox `PADDLE_API_KEY`,
`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, and the destination's `PADDLE_WEBHOOK_SECRET`
from the local secret store. Register the product's active Sandbox price
mappings before opening checkout. Stripe is the default provider.

The Workspace owner's checkout action creates and registers a Paddle
transaction before the browser can open it. Paddle.js opens that transaction
on the application checkout page after the page verifies the Workspace association.
The signed `transaction.completed` webhook and the authenticated return path
both reread the Paddle transaction and its linked subscription. They verify
customer, Workspace, mutation, environment, and mapped price before applying
the existing leased subscription projection and settling the checkout.

A test notification destination can forward only the Paddle webhook path
(`/api/billing/paddle/webhook`) over HTTPS. The lifecycle job drains Paddle
receipts. Hosted checkout sets a transaction-specific payment link for the
consumer's approved Sandbox domain. This preserves any shared seller's default
payment link and other products' notification destinations.

Paddle previews immediate price changes with tax and proration. The update
requires payment success when it collects a charge. For a period-end change,
Core verifies that the provider preview preserves the current paid boundary
and has no immediate charge. The adapter records the old and next price in the
same Paddle update so the existing entitlement stays active until the
boundary. Some changes of billing interval move the provider renewal date.
Core declines such previews before writing to Paddle.

For annual-to-monthly changes, Paddle Sandbox moved the renewal about a
month after the update even when the request included the existing annual
end. A separate billing-date update restored the original date, but a
failure between those requests would leave the early renewal in place.
Keep the preview guard for that path.

For a Workspace owner's same-plan annual-to-monthly change, Core schedules a
Paddle pause at the verified annual end and records the approval in the
existing billing transition. Paddle keeps the annual price and the Workspace
keeps paid access until that boundary. Undo clears the scheduled pause and
restores the annual renewal. Schedule the change before Paddle's 30-minute
renewal lock.

The existing billing lifecycle job checks due Paddle Sandbox pauses. It
requires the recorded boundary, owner approval, current Workspace binding,
and Paddle's paused state before staging the monthly price without billing.
Paddle resets its period dates during staging, so the Workspace still
projects the last paid period. Core records one durable resume claim before
sending the billable request. On an uncertain result, later runs reconcile
Paddle's state without sending a second resume. An unresolved attempt that
stays paused requires operator review. The monthly paid period opens only
after reconciliation verifies a completed payment.

Paddle owns recurring collection. An advanced paid period requires an
authoritative completed recurring transaction for the same subscription,
customer, price and period. Signed lifecycle events trigger the existing
leased reconciliation. The paid period uses precise timestamps, including
short periods that fit within one UTC date.

The owner can open the Paddle-hosted portal for the verified subscription.
For hosted Sandbox, the app includes a portal token only when the current
owner's confirmed email matches the provider's buyer email. Otherwise Paddle
authenticates the buyer. This keeps access to a shared seller's buyer-wide
portal bound to the buyer's identity. The same customer and subscription
checks protect invoice downloads. PlaceDJ keeps server-verified resource limits
in downgrade eligibility and applies its device-local cache limit through
Player reconciliation at the plan boundary.

## Paddle Live configuration

Set the production environment to `SAAS_CORE_BILLING_PROVIDER=paddle`
and `PADDLE_ENVIRONMENT=live`. `PADDLE_APP_ORIGIN` must be the approved
HTTPS application origin and match `APP_URL`. Set `PADDLE_ACCOUNT_ID` to
the selected Live seller ID. Core checks the seller ID against the Paddle
API before using the configured server key. Production and Sandbox use
separate API keys, client-side tokens, webhook secrets, and price mappings.

`PADDLE_LIVE_CHECKOUT_MODE` defaults to `disabled`. Set it to `pilot` with
`PADDLE_LIVE_CHECKOUT_WORKSPACE_ID` to open new checkout for one Workspace
owner. Set it to `enabled` to open checkout to eligible Workspace owners.
Closing new checkout leaves webhook delivery, recurring payment
reconciliation, and previously approved billing changes active.

Each PlaceDJ checkout transaction supplies its approved checkout URL.
The checkout page recognizes Paddle payment links and verifies the
transaction against the signed-in owner's Workspace before opening it.
On Live, the subscription link lets Paddle authenticate the buyer by
email, which keeps the shared seller's customer-wide portal session out
of the Workspace. A verified canceled Stripe Sandbox subscription can be replaced by the
Workspace's first verified Paddle Live checkout. The old Checkout and
provider event records remain available for audit.

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
deduplicates provider event IDs, and ignores events older than the current
projection timestamp. Unknown prices, workspaces, subscriptions, or
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
keeps current entitlements through its exact effective timestamp. Past-due
recovery retains paid access for the configured grace period; expiry moves
only effective entitlements to the fallback and preserves data, usage, and
provider history. Resume clears a scheduled cancellation after provider
confirmation.

A same-plan billing-cycle change is recorded as `interval_change` and uses the
normal preview, explicit confirmation, provider mutation, reconciliation, and
durable transition path without downgrade eligibility or downgrade copy. The
policy is intentionally asymmetric: month → year is immediate and uses
`prorated_immediately`; year → month uses the provider's frequency replacement
with `do_not_bill`, keeps the already-paid annual period and current annual
entitlements through its exact period end, and projects the monthly interval
locally for that boundary. It does not shorten the annual period or bill early.
A same-interval request is rejected before provider work.

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
past its local billing period, expired, paused, canceled, unknown, or mapped to an inactive plan. `null` is
the only unlimited limit; an omitted or malformed capability is unavailable.
Non-manual paid projections also require a complete local provider identity;
normal entitlement reads never call Stripe synchronously.

The root migration and application template carry both durable billing
persistence and the server-only entitlement lock boundary. The CLI delivers
those files as source and never applies SQL. Consumers must apply and verify
the migrations in their own controlled database workflow, define their own
commercial catalog/provider mappings, register product usage resolvers, and
guard product mutations. See [BILLING-CONSUMER.md](./BILLING-CONSUMER.md) for
the exact integration contract and [BILLING-PARITY.md](./BILLING-PARITY.md) for
the ReserveVia comparison.
