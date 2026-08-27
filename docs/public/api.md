# REST API

Base URL: `https://api.reservevia.com/v1` when the API hostname is configured. The application-compatible path is `/api/v1`.

## Read endpoints

- `GET /restaurants/search` — public, rate limited discovery.
- `GET /restaurants/{restaurant_id}` — safe public restaurant data and AI readiness.
- `GET /restaurants/{restaurant_id}/availability` — live availability; do not cache long-term.
- `GET /businesses` — OpenAI-compatible public business feed.

## Mutation endpoints

- `POST /reservation-holds` — short-lived hold; requires `reservations:write`.
- `POST /reservations` — create one reservation; requires `reservations:write` and `x-reservevia-user-confirmed: true`.
- `GET /reservations/{reservation_id}/confirmation` — requires `reservations:manage` and `X-Reservation-Management-Token`.
- `PATCH /reservations/{reservation_id}` — modify securely.
- `POST /reservations/{reservation_id}/cancel` — cancel securely.

## Authentication

Mutation endpoints require a provider-neutral ReserveVia API client credential: `Authorization: Bearer rv_live_...`. Credentials are stored as hashes and are issued by Platform Control or a controlled server-side issuance flow. No diner account is required.

## Idempotency

All mutation requests require `Idempotency-Key`. The same client, operation, key, and request body replay the original result. A different body with the same key returns `IDEMPOTENCY_CONFLICT`.

## Error example

```json
{"error":{"code":"SLOT_NO_LONGER_AVAILABLE","message":"The selected time is no longer available.","retryable":true,"suggested_action":"refresh_availability"}}
```

See `/openapi.json` for schemas, examples, authentication, and rate-limit behavior.
