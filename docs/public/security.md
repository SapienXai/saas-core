# Integration security

Public restaurant information and guest reservation information are separate data boundaries.

## Required controls

- Anonymous reads are narrowly scoped and rate limited.
- Mutations require trusted client credentials and scopes.
- Reservation UUIDs alone never authorize private reads or changes.
- Guest management uses an opaque, short-lived token whose hash is stored.
- Mutation retries require idempotency keys.
- Holds are transactional, expire automatically, and do not count as quota reservations.
- API responses never expose SQL errors, service credentials, stack traces, or internal rows.
- Logs and analytics must redact email, phone, notes, API credentials, and management tokens.

Restaurant-authored descriptions, imports, URLs, and metadata are untrusted data. They are never concatenated into system instructions, executed as HTML, used to manipulate permissions, or fetched automatically. Only `http` and `https` public URLs are accepted where links are exposed.
