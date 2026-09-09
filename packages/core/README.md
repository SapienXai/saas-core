# @sapienx/saas-core

Current release: runtime `2.2.0`; Core database schema `2.0`. This is a
backward-compatible minor release with no Core database migration.

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
service-role, Paddle, or product-domain code.

Import it from Core runtime adapters and product tooling. Products define their
own plan names, prices, feature keys, and usage metrics through the config
boundary; Core only evaluates stable keys and lifecycle contracts.
