# Agent REST API

The public compatibility path is `/api/v1`. The future API hostname `api.reservevia.com` can point to the same route without changing the domain layer. DTOs live in `lib/ai/contracts.ts`; OpenAPI is served at `/openapi.json`.

Read endpoints are public and policy-rate-limited. Mutation endpoints require a hashed API client credential, scopes, idempotency keys, and safe error responses. `x-reservevia-user-confirmed: true` is required for reservation creation.

See the public source at [`docs/public/api.md`](public/api.md) and the generated machine contract at `/openapi.json`.
