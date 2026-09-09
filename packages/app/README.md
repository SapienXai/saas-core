# `@sapienx/saas-core-app`

Current package release: `2.2.0`; Core schema remains `2.0`. This package is the
template carrier for the coordinated minor release and adds no database
migration by itself.

This package carries the portable application template extracted from the
production management implementation. The CLI materializes its
`template/` into a new product so the consumer receives the actual Core app
shell, auth, workspace, team, plan, settings, PWA, domain, and platform
surfaces rather than a placeholder scaffold.

The template owns no product domain. Product code is added under the Workspace
boundary after initialization. It is consumed by the CLI as the one canonical
template source; generated products receive its source files and do not need
this package at runtime. Its `templateDependencies` field is packaging metadata
for the materialized application, not a runtime dependency list for this
template-carrier package.

The managed template carries the Core billing route and lifecycle projection,
workspace-scoped persistence and entitlement helpers, and the plan and
confirmed-success surfaces. Products provide their own catalog, provider
mapping, and domain usage writes while the managed files retain authorization,
webhook, recovery, and rollback behavior.
