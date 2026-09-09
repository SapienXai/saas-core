# Billing parity and ownership

This document records the phase-one audit of the reusable billing boundary.
The comparison is against SaaS Core `9bd1b4e0997e6a85330ed08f4391e88c9ec1102e`,
ReserveVia `92ffa98dd22e785d90959b292c341de1e57e6873`, and PlaceDJ
`5fd2765bf3b36dd2be8e6c9105e40d410f4bc995`. ReserveVia and PlaceDJ were read
only references. This phase changes the Core contract and its validation
tests; it does not change Paddle calls, database migrations, or either
consumer.

## Audited capability matrix

| Capability | ReserveVia evidence and behavior | SaaS Core boundary | Remaining work |
| --- | --- | --- | --- |
| Free and default plan | `supabase/migrations/20260809155804_plans_subscriptions_and_usage.sql` seeds a fixed Free plan; `bootstrap_initial_workspace` assigns it. | `ProductCatalog.defaultPlanKey` is explicit, and the contract validates that it names a plan with an explicit `limits.core.workspaces` value. | Billing persistence and every runtime fallback must use the configured key consistently. |
| Catalog and prices | `public.plans` contains fixed Starter, Pro, and Business rows plus monthly provider mappings. | Product catalogs own plan keys, prices, features, limits, and usage metric keys. Core accepts arbitrary valid keys and month/year prices. | Consumers must supply their own paid catalog and provider mappings during their migrations. |
| Workspace customer mapping | `workspace_subscriptions` stores the provider customer and subscription IDs; checkout can create the first customer and verified events associate it. | A provider adapter will map one recurring base subscription to a workspace and environment. Browser input cannot select a customer, plan, or price. | The persistence phase adds the durable environment-scoped account association and conflict checks. |
| Checkout | `app/manage/plan/actions.ts` resolves the workspace owner, mapping, and environment server-side before creating checkout. Checkout completion alone never grants paid access. | The contract exposes no provider client and contains no checkout side effect. | The lifecycle phase keeps the existing action surface as a compatibility wrapper around a canonical provider service. |
| Upgrade | ReserveVia previews the change and requests immediate proration; local access changes after a verified provider event. | `getBillingProrationMode("upgrade")` is `immediate`; the provider adapter translates that semantic mode. | Preserve the exact preview, authorization, idempotency, and provider-confirmed projection in the lifecycle phase. |
| Downgrade and undo | ReserveVia requests next-period billing treatment and keeps the current plan until the scheduled boundary; a pending change can be undone. | `getBillingProrationMode("downgrade")` is `next_period`; scheduled transitions are distinct from immediate status changes. | Persist the transition journal and exact effective timestamp, including recoverable failed or unknown outcomes. |
| Cancellation and resume | Cancellation is scheduled for the end of the current period. Resume clears that scheduled cancellation; it does not treat a paused provider subscription as resumed. | Transition kinds include `cancel` and `resume`; future effective timestamps resolve to `schedule`. | Implement provider calls, durable mutation state, and event projection without optimistic access changes. |
| Renewal and status projection | Verified subscription events update period, price, status, and provider timestamps. Active and trialing retain the purchased plan. | Provider adapters normalize to `active`, `trialing`, `past_due`, `paused`, or `canceled`. Unknown states fail closed before projection. | Add canonical event normalization, stale/equal timestamp handling, and reconciliation. |
| Past due and recovery | A past-due workspace retains its paid entitlements for 14 days. A verified recovery restores access; expiry moves effective access to the fallback plan. | The default grace policy is 14 days and can be configured without naming a product plan. `null` grace timestamps do not claim expiry. | Apply one policy in server and database entitlement enforcement and run boundary tests. |
| Paused, canceled, and expired access | Paused and canceled subscriptions fall back to Free while data, usage, and provider history remain. A later checkout may replace a terminal subscription safely. | `resolveEffectiveBillingPlan` selects the configured fallback for paused, canceled, or expired grace. | Add safe canceled-subscription replacement and reconciliation before retrying uncertain provider operations. |
| Webhook verification and inbox | The webhook route reads the raw body once, verifies the official signature first, stores a minimal unique inbox record, and processes it idempotently. | The contract describes operation and transition outcomes only; it has no network or persistence dependency. | Keep raw-body verification before persistence, then add atomic claim leases, retry, and observability. |
| Duplicate and ordering protection | Provider event IDs deduplicate delivery and `occurred_at` prevents an older event from overwriting a newer projection. Unknown prices, workspaces, subscriptions, or environments fail closed. | Transition decisions distinguish `pending`, `succeeded`, `failed`, and `unknown`; unknown outcomes require reconciliation. | Extend the same ordering rule to transaction events and equal-time reconciliation. |
| Reconciliation | `scripts/billing-reconcile.mjs` fetches current provider state and repairs local drift only when the provider timestamp is newer. | Core owns the reconciliation policy; consumers do not own a second billing engine. | Consolidate duplicated projection logic behind one provider-neutral service. |
| Entitlements and usage | `lib/entitlements.ts` reads keyed features, limits, and usage. Product writes enforce restaurant, user, reservation, and history rules transactionally. | Features, limits, and usage metrics are open-ended product keys. A missing limit is unavailable; `null` explicitly means unlimited. | Move generic effective-plan and usage assertions behind the Core boundary while products keep domain writes. |
| Billing presentation | ReserveVia supplies plan names, prices, feature labels, comparison content, recovery copy, and success feedback from its product surface. | Optional presentation config validates plan order, plan copy, comparison rows, and feature/limit references. | The UI phase drives the existing shared surface from product configuration and persists confirmed transition consumption. |

## Ownership rules

SaaS Core owns the provider-neutral lifecycle vocabulary and policy helpers,
provider adapter boundary, provider price registry, checkout and mutation
journal, webhook inbox, reconciliation, grace policy, keyed entitlement
helpers, billing actions, plan selection, status notices, and confirmed
success semantics. Core must continue to work when a product has one plan or
many plans and when plan keys are arbitrary valid strings.

ReserveVia owns its plan definitions and prices, restaurant and reservation
limits, history rules, marketing labels, and product-specific copy. Its
existing `reservevia_*` custom-data keys and fixed plan names stay in that
consumer migration and are translated at the adapter boundary.

PlaceDJ owns venue, device, music, and catalog definitions, their usage
metrics and limits, and product copy. Core does not interpret a Workspace as
one of those entities and must not add those names to its types or policies.

The direction remains `SaaS Core → product configuration → product domain`.
Product configuration can describe plans and copy; it cannot grant access,
choose a provider price from browser input, or replace server authorization.

## Consumer follow-up requirements

ReserveVia's migration must preserve existing provider IDs, subscription
history, and current entitlements; map legacy custom-data keys to the generic
workspace association; supply its four plan definitions, prices, comparison
copy, and domain metrics; and move runtime call sites to the Core contract.
The migration must prove Sandbox event ordering, payment recovery, canceled
replacement checkout, and rollback before any live rollout.

PlaceDJ's migration must begin with a Core update dry run against its manifest
and resolve managed-file conflicts without touching product-owned paths. It
must define paid plans, prices, venue/device/music/catalog limits, and copy in
its own catalog/configuration, then call Core entitlements and usage helpers
from authorized product write boundaries. It must not add a local provider
client, webhook, or checkout implementation.

Neither consumer migration is part of this phase. No provider credentials,
payment state, production data, or database schema was changed while writing
this specification.
