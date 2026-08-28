# @sapienx/saas-core

Portable workspace, entitlement, catalog, schema, manifest, and compatibility
contracts for SaaS Core products. This package contains no Next.js, Supabase
service-role, Paddle, or product-domain code.

Import it from Core runtime adapters and product tooling. Products define their
own plan names, prices, feature keys, and usage metrics through the config
boundary; Core only evaluates stable keys and lifecycle contracts.
