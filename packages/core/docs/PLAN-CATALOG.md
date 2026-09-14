# Plan catalog and consumer handoff

SaaS Core owns the subscription projection, lifecycle timestamps, effective
entitlement evaluation, generic quota primitives, workspace-scoped usage, and
the provider boundary. A product owns its plan keys, names, prices, copy,
feature/limit keys, usage resolvers, and product mutation transaction.

The stable plan key is the identity used by `ProductCatalog`,
`workspace_subscriptions`, and provider mappings. Keys are not renamed. Plan
rows can be activated, archived, duplicated, or edited by the server-only
Platform Billing actions. Archive keeps the row and every historical foreign
key intact. A plan referenced by subscription history cannot have its
entitlement maps or commercial metadata changed; presentation fields remain
editable. A plan referenced by an active subscription or scheduled change
cannot be archived until that lifecycle has ended.

## Define plans

Products define a catalog using the existing `ProductPlan` contract. The
following values are illustrative only; they are not SaaS Core pricing or
PlaceDJ limits:

```ts
const catalog = {
  defaultPlanKey: "free",
  plans: [
    {
      key: "free",
      name: "Free",
      description: "A small starting workspace",
      sort_order: 0,
      limits: { "core.workspaces": 1, members: 2, venues: 1 },
      features: { custom_domains: false },
    },
    {
      key: "pro",
      name: "Pro",
      sort_order: 10,
      recommended: true,
      limits: { "core.workspaces": 3, members: 10, venues: 5 },
      features: { custom_domains: true },
    },
    {
      key: "business",
      name: "Business",
      sort_order: 20,
      limits: { "core.workspaces": null, members: null, venues: null },
      features: { custom_domains: true },
    },
  ],
}
```

`null` is explicit unlimited. An omitted limit or feature is unavailable or
not configured; it is never treated as unlimited. The fallback plan must
explicitly define `limits.core.workspaces`.

Use the public package helpers when constructing or editing definitions:

```ts
import {
  classifyProductPlanChange,
  duplicateProductPlan,
  normalizeProductPlan,
  validatePlanDefinition,
} from "@sapienx/saas-core"
```

`duplicateProductPlan()` creates an inactive copy and strips provider price
references. Register new provider mappings separately with the existing
server-only billing mapping command. Do not put provider secrets or trusted
authorization state in browser input.

## Entitlements and usage

The runtime path is always:

```text
plan catalog → workspace subscription → effective plan → entitlements → usage
```

Use `createEntitlementService()` in the consumer to register an authoritative
resolver for a product-owned key:

```ts
const billing = createEntitlementService({
  usageResolvers: {
    venues: async ({ workspaceId, db }) => {
      const { count, error } = await db
        .from("venues")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
      if (error) throw error
      return count || 0
    },
  },
})
```

Usage is workspace-scoped in the current Core model. Core calculates its own
workspace/member usage; the consumer calculates domain usage. Never accept a
plan, workspace, limit, or usage value from the browser as authoritative.

## Enforce mutations

Guard the product mutation on the server after resolving the authenticated
workspace:

```ts
await billing.assertCanConsume(workspaceId, "venues", 1, userId)
await createVenue({ workspaceId, ...input })
```

For check-then-insert quota races, call
`public.lock_workspace_entitlement(workspace_id, capability)` from a
product-owned transaction RPC, then count and insert the product row in that
same transaction. Core holds the workspace/capability lock; the product owns
the table query and write. Errors are structured (`PLAN_LIMIT_REACHED`,
`FEATURE_NOT_AVAILABLE`, `INVALID_PLAN`, or `SUBSCRIPTION_REQUIRED`) and can
be serialized with `serializeEntitlementError()`.

## Subscription lifecycle

Checkout, upgrade, downgrade, cancellation, and reactivation continue through
the existing server-authorized provider adapter and normalized local
`workspace_subscriptions` row. Provider webhooks, not a browser callback,
activate paid entitlements. A scheduled downgrade or cancellation remains on
the current plan until its effective timestamp. If usage is above the target
plan, existing data stays intact and new restricted mutations are blocked.

Missing, expired, canceled, paused, stale, malformed, or unmapped paid state
resolves to the configured fallback or a restrictive error. It never grants
premium or unlimited access.

## UI handoff

The managed application exposes plan comparison, current plan, usage meters,
and `EntitlementLimitNotice`. The package UI exports the reusable billing
primitives. Consumers pass their own labels, capability keys, prices, and
required-plan copy; Core does not know what a venue, reservation, playlist, or
other product resource means.
