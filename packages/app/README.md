# `@saas-core/app`

This package carries the portable application template extracted from the
production management implementation. The CLI materializes its
`template/` into a new product so the consumer receives the actual Core app
shell, auth, workspace, team, plan, settings, PWA, domain, and platform
surfaces rather than a placeholder scaffold.

The template owns no product domain. Product code is added under the Workspace
boundary after initialization.
