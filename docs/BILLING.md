# Billing

Paddle is the first supported provider. The provider boundary covers checkout,
portal sessions, cancellation and signed webhook processing. Store a minimal
durable webhook inbox keyed by `(provider, provider_event_id)`, process each
event idempotently and reject events older than the local
`last_provider_event_at`.

Paddle is never queried by product authorization at request time. Local
`workspace_subscriptions` and the entitlement engine remain authoritative.
Payment failures, grace, cancellation and scheduled plan changes are local
state transitions sourced by verified provider events.
