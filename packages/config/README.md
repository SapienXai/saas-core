# @sapienx/saas-core-config

Part of the coordinated SaaS Core `2.6.0` runtime/package release; Core schema
compatibility coordinate remains `2.0`. The release's additive, Core-managed
billing migration sources are carried by the application template and CLI.
This package defines product configuration and does not execute SQL; consumers
apply and verify the sources through their own controlled migration process.

The typed product-owned identity and commercial boundary: name, slug, branding,
navigation, capabilities, plan catalog, feature keys, and usage metrics.
Provider credentials and authorization do not belong in this package.

The optional `billing`/`billingPolicy` and `billingPresentation` fields extend
that same product boundary with supported intervals, fallback policy, plan
ordering, comparison rows, and copy. `defineProductConfig()` validates their
references against the product catalog; it does not select provider IDs or
perform billing operations.
