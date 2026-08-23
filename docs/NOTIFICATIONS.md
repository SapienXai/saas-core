# Notifications

Resend email and Web Push are provider adapters. Transactional business writes
should not roll back because delivery failed. Use a durable outbox or
idempotency key for retries, scope every message to workspace/user, keep push
payloads minimal and revoke dead subscriptions.
