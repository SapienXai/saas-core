# `@sapienx/saas-core`

The framework-agnostic SaaS foundation. It owns the workspace boundary and
platform services; a product owns its domain entities and can register its own
feature keys, usage metrics, lifecycle stages, and scope adapters.

The package has no database or UI dependency. Use `InMemorySaaSStore` for local
scenarios/tests. Production applications use the companion
`@sapienx/saas-core-runtime` package, which owns the server-only Supabase
runtime, authenticated repositories and RPC calls without coupling product
domain tables to Core.
