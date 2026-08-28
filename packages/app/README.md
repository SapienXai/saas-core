# `@sapienx/saas-core-app`

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
