# SaaS Core 2.7.0 release candidate

The coordinated runtime and package version is **2.7.0**. The Core schema
compatibility coordinate remains **2.0**. The latest published package version
is 2.6.2.

- Paddle is the default for new checkout. Deployments that want Stripe for new
  checkout can select it explicitly. Existing subscriptions use their stored
  provider and environment for management and reconciliation. Paddle supports
  hosted checkout, signed receipts, portal identity verification, and shared
  subscription reconciliation. Paddle Live checkout is disabled by default.
  Stripe renewal projection requires matching paid invoice evidence before
  extending the paid period.
- The entitlement gate requires a current paid period for provider-backed
  access. Legacy UTC date-only periods remain accepted.
- Public Workspace resolution uses the ingress Host by default. A trusted
  reverse proxy can opt into forwarded-host handling.
- The disposable consumer proof exercises product-owned routes, components,
  quota enforcement, a flat RLS migration and a server-resolved public page.

## Upgrade and deployment

Review the managed-file diff and update dry run. Run the
[read-only period audit](../scripts/audit-provider-periods.sql) and reconcile
legitimate incomplete rows with their original provider before cutover. Stage
the managed sources, apply
`20261111100704_require_provider_entitlement_period.sql` through the
consumer's controlled Supabase workflow, then deploy the matching app. The
CLI delivers SQL source without executing it. See [Upgrading](./UPGRADING.md) and
[Billing architecture](./BILLING-ARCHITECTURE.md).

All five packages share the same version. `pnpm core:pack` builds the
tarballs, `pnpm release:packages` inspects them, and
`pnpm core:consumer-proof` installs them through a disposable local registry.
See the [verification record](./CORE-2.7.0-READINESS.md) and
[BookPlace capability assessment](./BOOKPLACE-CONSUMER-READINESS.md).
