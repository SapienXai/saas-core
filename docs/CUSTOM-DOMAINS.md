# Custom domains

Normalize a hostname once: lowercase, strip a safe scheme/trailing dot, reject
paths, credentials, wildcards, IPs, localhost and platform-owned hosts. Store a
unique normalized hostname and provider lifecycle state. Public resolution reads
the local verified mapping; it must not call Vercel/DNS on every request.

The domain entitlement gates activation, while stored mapping data remains
recoverable if the plan changes.
