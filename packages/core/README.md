# @sapienx/saas-core

Current release: runtime `2.2.1`; Core schema compatibility coordinate `2.0`.
The release delivers the additive, Core-managed migration source
`supabase/migrations/20260909094344_reusable_billing_persistence.sql` through
the canonical application template and CLI. This package exports the generic
contracts; it does not execute SQL. Consumers apply and verify the delivered
source through their own controlled migration process.

Generic SaaS Core contracts include product configuration, compatibility
metadata, and the Agent Surface contract. Use `defineAgentTool()` for a
validated, transport-neutral capability definition; the managed application
template supplies the page-scoped WebMCP adapter.

Billing is provider-neutral at this boundary. The package exports the
interval, status, transition, outcome, proration, retry, effective-plan, and
presentation contracts, plus deterministic helpers such as
`resolveBillingPolicy()`, `resolveEffectiveBillingPlan()`, and
`resolveBillingRetry()`. A consumer can pack and validate these exports
without loading a provider SDK or making a network call.

Portable workspace, entitlement, catalog, schema, manifest, and compatibility
contracts for SaaS Core products. This package contains no Next.js, Supabase
service-role, Paddle, migration execution, or product-domain code. Its package
boundary does not own the template's migration files.

Import it from Core runtime adapters and product tooling. Products define their
own plan names, prices, feature keys, and usage metrics through the config
boundary; Core only evaluates stable keys and lifecycle contracts.
