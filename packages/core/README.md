# @sapienx/saas-core

Current release: runtime `2.1.0`; Core database schema `2.0`.

Generic SaaS Core contracts include product configuration, compatibility
metadata, and the Agent Surface contract. Use `defineAgentTool()` for a
validated, transport-neutral capability definition; the managed application
template supplies the page-scoped WebMCP adapter.

Portable workspace, entitlement, catalog, schema, manifest, and compatibility
contracts for SaaS Core products. This package contains no Next.js, Supabase
service-role, Paddle, or product-domain code.

Import it from Core runtime adapters and product tooling. Products define their
own plan names, prices, feature keys, and usage metrics through the config
boundary; Core only evaluates stable keys and lifecycle contracts.
