# Architecture

SaaS Core is a modular monolith delivered as versioned packages. The core
boundary ends at `Workspace`; products own their entities, routes, screens and
industry-specific policies.

```text
Auth session → Workspace → Membership → Permission
                         → Plan → Entitlement → Usage
                         → Provider adapters → Platform Control / Audit
                         → Product domain
```

The domain package is framework-neutral. A server adapter supplies Supabase
session resolution, persistence, transactions, logging and provider secrets.
The in-memory store is a reference implementation for deterministic tests, not
a production persistence layer.

Core uses extension points for product features, metrics, lifecycle stages and
resource/scope access adapters. It does not create universal resources or
rename product entities into generic abstractions.
