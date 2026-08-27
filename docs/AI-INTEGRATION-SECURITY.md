# AI integration security

Threat model and controls are documented publicly in `docs/public/security.md` and summarized here for engineering.

- Restaurant/import content is untrusted and cannot alter instructions or tool permissions.
- Only safe HTTP(S) links are exposed; no automatic fetch of restaurant-controlled URLs.
- API clients store credential hashes, not permanent secrets.
- Guest management tokens are opaque, scoped, short-lived, and hashed at rest.
- UUIDs are identifiers, not authorizers.
- Every trusted mutation is rate limited and replay protected.
- Error responses are normalized and do not include SQL, Supabase, stack, or service details.
- Observability must use request IDs and redaction; guest contact, notes, API credentials, and tokens are not log fields.
