# @sapienx/saas-core

Current release: runtime `2.6.0`; Core schema compatibility coordinate `2.0`.
The release delivers the additive, Core-managed billing, entitlement-lock, and
plan-catalog migration sources through the canonical application template and
CLI. This package exports the generic contracts; it does not execute SQL.
Consumers apply and verify the delivered sources through their own controlled
migration process.

Generic SaaS Core contracts include product configuration, compatibility
metadata, the workspace-owned Domain/PublicSite contract, and the Agent
Surface contract. Use `defineAgentTool()` for a
validated, transport-neutral capability definition; the managed application
template supplies the page-scoped WebMCP adapter.

Billing is provider-neutral at this boundary. The package exports the
interval, status, transition, outcome, proration, retry, effective-plan,
presentation, plan, and entitlement contracts, plus deterministic helpers
such as `resolveBillingPolicy()`, `resolveEffectiveBillingPlan()`,
`resolveBillingRetry()`, `getUsageSnapshot()`, and
`evaluateEntitlementConsumption()`, and `getEntitlementGateState()`. The Plan
Catalog consumer handoff is shipped at `docs/PLAN-CATALOG.md`. A
consumer can pack and validate these exports without loading a provider SDK or
making a network call. Gate state is advisory UI output; server-side mutation
authorization remains the consumer's responsibility. The public
`evaluatePlanChangeEligibility()` contract provides fail-closed target-plan
checks for explicit downgrades; `null` is unlimited and missing configuration
is unavailable.

Plan catalog consumers can also use `validatePlanDefinition()`,
`normalizeProductPlan()`, `duplicateProductPlan()`, and
`classifyProductPlanChange()`. A duplicate is intentionally inactive and has
no provider price reference; provider mappings must be registered separately.

Portable workspace, entitlement, catalog, public-domain, schema, manifest, and
compatibility contracts for SaaS Core products. `CoreDomainService` describes
the product-neutral `listDomains`, platform-subdomain mutation, and
`resolveHost` boundary. This package contains no Next.js, Supabase
service-role, Paddle, migration execution, or product-domain code. Its package
boundary does not own the template's migration files.

Import it from Core runtime adapters and product tooling. Products define their
own plan names, prices, feature keys, and usage metrics through the config
boundary; Core only evaluates stable keys and lifecycle contracts.
