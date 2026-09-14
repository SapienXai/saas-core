# Consumer billing integration

This guide is the Phase 2 handoff for a product that consumes SaaS Core. Core
owns the workspace subscription projection and entitlement policy. The
consumer owns product tables, product usage queries, catalog values, and the
transaction that inserts its resource.

## 1. Define plans and entitlements

Use product configuration. Plan keys and commercial values are not hardcoded
in Core. The following is an illustrative contract only, not a SaaS Core or
PlaceDJ pricing decision:

```ts
export const productCatalog = {
  defaultPlanKey: "free",
  plans: [
    {
      key: "free",
      name: "Free",
      sort_order: 0,
      limits: { "core.workspaces": 1, members: 2, venues: 1 },
      features: { customDomains: false },
    },
    {
      key: "pro",
      name: "Pro",
      sort_order: 10,
      recommended: true,
      limits: { "core.workspaces": 3, members: 10, venues: 5 },
      features: { customDomains: true },
    },
    {
      key: "business",
      name: "Business",
      sort_order: 20,
      limits: { "core.workspaces": null, members: null, venues: null },
      features: { customDomains: true },
    },
  ],
  usageMetrics: [{ key: "venues", name: "Venues" }],
}
```

`null` is the only unlimited representation. Omit a capability only when it
should be unavailable/unconfigured. A product must explicitly define
`limits.core.workspaces` on its fallback plan so workspace bootstrap cannot
silently become unrestricted.

`recommended` is copied into plan metadata during catalog synchronization for
the managed plan cards. Presentation labels, comparison rows, and plan order
are validated against the same keys.

## 2. Map Paddle prices on the server

Register each environment/interval mapping in Core's
`billing_provider_prices` boundary using the existing server-only billing
command or an equivalent controlled migration. Keep provider product/price
identifiers out of browser input and out of the provider-neutral package.
Checkout and plan-change actions resolve the mapping from the requested plan
key, interval, and active environment on the server. Do not invent or commit
provider identifiers in Core.

Paddle events are verified from the raw request body, deduplicated, ordered by
provider time/event ID, and projected into `workspace_subscriptions`.
Checkout success or a browser callback alone never activates paid access.

## 3. Register authoritative usage

The generated application includes the product-owned server extension
`src/product/usage.ts`. Replace its empty resolver map with authoritative
queries for the product's own resource keys:

```ts
import type { UsageResolverMap } from "@/lib/entitlements"

export const PRODUCT_USAGE_RESOLVERS: UsageResolverMap = {
  locations: async ({ workspaceId, db }) => {
    const { count, error } = await db
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("archived_at", null)
    if (error) throw error
    return count || 0
  },
}

export function getProductUsageResolvers(): UsageResolverMap {
  return PRODUCT_USAGE_RESOLVERS
}
```

`getWorkspaceUsage`, the shared Plan action, and `createEntitlementService()`
automatically compose this product map with Core's built-in
`core.workspaces` and `core.members` resolvers. A product may still pass an
explicit `usageResolvers` map to an isolated service; explicit keys override
product defaults, while Core-owned structural metrics remain authoritative.
The file is product-owned, so `saas-core update` never replaces it. An older
consumer that does not have the file receives a one-time neutral scaffold.

Resolvers run only from server modules and receive the canonical workspace,
optional actor, billing period, current time, and a server-only database
handle. Core validates every result as a finite non-negative number. A missing
resolver, invalid result, or resolver exception is `USAGE_UNAVAILABLE`; it is
never converted to `0` and never grants a finite quota.

## 4. Guard a server mutation

Every product server action or route must authenticate the caller, resolve the
workspace from server-side membership, and guard before the product write:

```ts
await entitlements.assertCanConsume(workspaceId, "venues", 1, userId)
await createVenueInProductRepository({ workspaceId, ...input })
```

The guard resolves the effective local plan, then the configured capability,
then authoritative usage. It returns or throws structured codes such as
`PLAN_LIMIT_REACHED`, `FEATURE_NOT_AVAILABLE`, `INVALID_PLAN`, and
`SUBSCRIPTION_REQUIRED`. Serialize only `serializeEntitlementError(error)`;
never return provider objects, service credentials, or raw database errors to
the client. The client cannot submit a trusted plan, limit, usage value, or
workspace identity.

For advisory client rendering, the provider-neutral Core package exports
`getEntitlementGateState()`, which returns `allowed`, `hidden`, `disabled`,
`upgrade_required`, `limit_reached`, or `over_limit` from the same evaluator.
Use it to choose visibility and copy only; the server guard remains the
authority.

## 5. Protect check-then-insert quota mutations

For a finite quota, a separate JavaScript count followed by an insert is not
atomic. A product-owned security-definer RPC should call the Core lock helper
inside the same transaction, then count and insert its own row:

```sql
declare
  policy record;
  used_count integer;
begin
  select * into policy
    from public.lock_workspace_entitlement(p_workspace_id, 'venues');

  if not policy.capability_configured then
    raise exception using message = 'INVALID_PLAN';
  elsif not policy.feature_enabled then
    raise exception using message = 'FEATURE_NOT_AVAILABLE';
  end if;

  select count(*) into used_count
    from public.venues
   where workspace_id = p_workspace_id and status = 'active';

  if not policy.unlimited and used_count + 1 > policy.limit_value then
    raise exception using message = 'PLAN_LIMIT_REACHED';
  end if;

  insert into public.venues (workspace_id, name) values (p_workspace_id, p_name);
end;
```

The product RPC must perform its own authenticated membership/role check,
restrict its `search_path`, and keep the count and insert in one transaction.
`lock_workspace_entitlement` holds a workspace/capability advisory lock and
locks the local subscription row, so participating mutations cannot both pass
the same finite quota check. The helper is server-only; consumers should not
expose it directly to browser clients.

## 6. Render usage and limit feedback

The managed app can render all configured metrics through `ManageUsageMetric`.
The UI package also exports `BillingUsageMeter` and
`EntitlementLimitNotice`:

```tsx
<BillingUsageMeter label="Venues" current={1} limit={1} />
<EntitlementLimitNotice
  capability="venues"
  label="Venues"
  current={1}
  limit={1}
  requiredPlan="pro"
/>
```

The components distinguish `Limit unavailable`, finite limits, and
`Unlimited`. Labels, capability keys, and required-plan copy are inputs; Core
does not mention a product domain. Feature visibility and disabled states are
advisory only. The server guard remains authoritative.

## 7. Downgrade, cancellation, and failure states

A scheduled downgrade or cancellation keeps the current plan until its actual
effective timestamp. If current usage exceeds the target plan, existing
resources remain intact, the workspace is visibly over limit, and new
restricted mutations are rejected. Nothing is silently deleted.

Paused, canceled, expired-period, unknown, malformed, or unmapped billing state uses
the configured fallback plan or returns a restrictive verification error. A
missing customer or local subscription is not premium access. Only an explicit
server-controlled manual plan state may bypass provider identity checks. Paddle
is not called synchronously for normal entitlement reads.

## 8. Ownership and verification checklist

The subscription owner is the Core Workspace (`workspace_subscriptions` has a
workspace primary key). Product usage is normally workspace-scoped. Verify the
following in the consumer before Phase 2 completion:

- product plan/catalog validation and server-side provider mapping;
- no-subscription fallback, ended subscription, paused/past-due behavior;
- resolver failures, unknown capabilities, finite/unlimited limits, and typed
  errors;
- authenticated mutation guard and transaction-level quota protection;
- duplicate/delayed webhook handling and scheduled effective dates;
- current-plan, comparison, usage, downgrade-warning, cancellation, and
  limit-reached UI on desktop and mobile.
