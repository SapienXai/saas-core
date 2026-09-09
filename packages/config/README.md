# @sapienx/saas-core-config

Part of the coordinated SaaS Core `2.2.0` runtime/package release; Core schema
remains `2.0` and this package adds no database migration.

The typed product-owned identity and commercial boundary: name, slug, branding,
navigation, capabilities, plan catalog, feature keys, and usage metrics.
Provider credentials and authorization do not belong in this package.

The optional `billing`/`billingPolicy` and `billingPresentation` fields extend
that same product boundary with supported intervals, fallback policy, plan
ordering, comparison rows, and copy. `defineProductConfig()` validates their
references against the product catalog; it does not select provider IDs or
perform billing operations.
