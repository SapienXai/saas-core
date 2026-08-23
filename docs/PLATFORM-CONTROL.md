# Platform Control

Platform Control is a separate authorization boundary with overview,
Workspace 360, billing operations, domain lifecycle, user directory, support,
lifecycle, health and needs-attention views. Platform members use platform
roles, not workspace roles.

Support inspection is read-only by default and is audit logged. Manual
entitlement overrides require actor, reason, effective interval and revoke
state. Operational adapters should expose safe errors and structured metadata,
not provider secrets or customer PII.
