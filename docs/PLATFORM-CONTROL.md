# Platform Control

Platform Control is a separate authorization boundary with overview,
Workspace 360, billing operations, domain lifecycle, user directory, support,
lifecycle, health and needs-attention views. Platform members use platform
roles, not workspace roles.

Generated projects expose `/platform`, `/platform/workspaces`,
`/platform/users`, `/platform/billing`, `/platform/overrides`,
`/platform/domains`, `/platform/attention`, `/platform/health` and
`/platform/audit`. Billing detail is available at
`/platform/billing/[workspaceId]`. Search, attention and audit data are bounded
server-side RPCs with role-aware filters. Support and auditor paths are
read-only; billing administrators are restricted to billing and entitlement
operations.

Support inspection is read-only by default and is audit logged. Manual
entitlement overrides require actor, reason, effective interval and revoke
state. Create/revoke, billing reconcile and domain reconcile routes generate
operation IDs and write audit events. Domain reconciliation is not offered
until both Vercel token and project ID are configured; billing reconciliation
does not report success without provider evidence. Operational adapters should
expose safe errors and structured metadata, not provider secrets or customer
PII.
