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
- transition kinds: checkout, upgrade, downgrade, cancel, resume, renewal,
  and recovery;
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

An immediate plan change becomes effective only after the verified provider
event updates the local projection. A deferred downgrade or cancellation
keeps current entitlements through its exact effective timestamp. Past-due
recovery retains paid access for the configured grace period; expiry moves
only effective entitlements to the fallback and preserves data, usage, and
provider history. Resume clears a scheduled cancellation after provider
confirmation.

## Product integration boundary

Products provide catalog definitions, prices, feature and limit keys, usage
metrics, plan presentation, and domain-specific quota writes. Product server
actions call Core authorization and generic entitlement helpers before a
domain mutation. Core does not know what a product's Workspace contains and
does not own product tables, domain entities, marketing copy, or metrics.

ReserveVia keeps its restaurant, reservation, history, fixed plan ladder,
prices, and legacy custom-data translation in its own migration. PlaceDJ
keeps its venue, device, music, catalog, limits, and copy in its own product
configuration and write boundaries. Both consumers use the shared contract
through an explicit migration and keep their provider IDs and history
intact.

## Delivery sequence and current phase

The implementation sequence is deliberately additive:

1. Define and test the provider-neutral contract and record parity (this
   phase).
2. Add durable provider-account, event-lease, retry, mutation, and confirmed
   transition-consumption persistence.
3. Consolidate Paddle normalization, lifecycle actions, webhook projection,
   and reconciliation behind the contract.
4. Align server and database effective-plan and usage enforcement.
5. Drive the existing responsive billing UI from product catalog and copy,
   with server-confirmed success semantics.
6. Verify packaging, managed-file ownership, and each consumer migration.

This phase intentionally changes only the Core contract, product config
validation, focused contract tests, and these two specifications. Existing
Paddle runtime behavior, migrations, secrets, ReserveVia, and PlaceDJ remain
outside this checkpoint.
