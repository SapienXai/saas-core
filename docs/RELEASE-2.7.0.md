# SaaS Core 2.7.0 release candidate

The coordinated runtime and package version is **2.7.0**. The Core schema
compatibility coordinate remains **2.0**. The latest published package version
is 2.6.2.

- Stripe remains the default. Paddle adds explicit environment and provider
  selection, hosted checkout, signed receipts, portal identity verification,
  and subscription reconciliation through the shared projection.
- The entitlement gate requires a current paid period for provider-backed
  access. Legacy UTC date-only periods remain accepted.
- Public Workspace resolution uses the ingress Host by default. A trusted
  reverse proxy can opt into forwarded-host handling.
- The disposable consumer proof exercises product-owned routes, components,
  quota enforcement, a flat RLS migration and a server-resolved public page.

## Upgrade and deployment

Review the managed-file diff and update dry run. Apply the source update,
then apply `20261111100704_require_provider_entitlement_period.sql` through
the consumer's controlled Supabase workflow. Confirm provider rows with
incomplete periods can be reconciled before the production cutover. The CLI
delivers the SQL source. See [Upgrading](./UPGRADING.md) and
[Billing architecture](./BILLING-ARCHITECTURE.md).

All five packages share the same version. `pnpm core:pack` builds the
tarballs, `pnpm release:packages` inspects them, and
`pnpm core:consumer-proof` installs them through a disposable local registry.
See the [verification record](./CORE-2.7.0-READINESS.md) and
[BookPlace capability assessment](./BOOKPLACE-CONSUMER-READINESS.md).
