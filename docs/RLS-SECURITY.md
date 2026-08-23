# RLS and security

Enable RLS on every Core table. Policies use `auth.uid()` through restricted
`SECURITY DEFINER` membership predicates. Service-role access is server-only.
Do not expose service keys, webhook secrets, VAPID private keys or provider API
keys to browser bundles.

Security tests must include forged workspace IDs, cross-tenant reads/writes,
anonymous direct writes, platform/customer role confusion, invitation replay,
unsafe redirects, reserved hostnames and provider event replay/out-of-order
delivery.
