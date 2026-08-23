# `@sapienx/saas-core`

The framework-agnostic SaaS foundation. It owns the workspace boundary and
platform services; a product owns its domain entities and can register its own
feature keys, usage metrics, lifecycle stages, and scope adapters.

The package has no database or UI dependency. Use `InMemorySaaSStore` for local
scenarios/tests and implement the same service contracts with Supabase in a
server-only application boundary.
