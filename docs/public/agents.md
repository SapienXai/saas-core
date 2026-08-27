# ReserveVia for AI agents

## Identify a restaurant

Call `search_restaurants` or `GET /api/v1/restaurants/search`. Select the exact published `restaurant_id`. A slug is for human routing; it is not the machine identity.

## Check availability

Call `refresh_availability` or the REST availability endpoint with `restaurant_id`, local restaurant date, `party_size`, and an optional preferred time. Slots are live and volatile. Never cache them as restaurant metadata.

## Collect guest data

Read `required_guest_fields` from the restaurant detail or availability response. Ask only for missing fields. Never ask for private restaurant fields or reveal guest data in discovery.

## Create a hold

Use `hold_reservation` or `POST /api/v1/reservation-holds` after availability. Holds are short-lived and capacity-aware. A hold may be unavailable when a restaurant has not configured a finite area capacity; in that case, do not invent capacity.

## Create exactly one reservation

Obtain clear user confirmation. Send one unique `Idempotency-Key` with the reservation request. Retries with the same key and identical request return the original result. Reusing a key for a different request returns `IDEMPOTENCY_CONFLICT`.

```json
{
  "restaurant_id": "00000000-0000-4000-8000-000000000001",
  "hold_id": "00000000-0000-4000-8000-000000000002",
  "date": "2026-08-15",
  "time": "20:00",
  "party_size": 4,
  "guest": {"name": "Alex Example", "phone": "+900000000000", "email": "alex@example.test"},
  "source_channel": "agent_rest"
}
```

The response contains a reservation ID, confirmation URL, and a short-lived scoped management token. Treat that token like a password; never log it or put it in a URL.

## Modify or cancel

Use the reservation ID together with the scoped management token. The UUID alone is never sufficient. Modify with `PATCH /api/v1/reservations/{reservation_id}` and cancel with `POST /api/v1/reservations/{reservation_id}/cancel`.

## Errors

Errors are machine-readable: `code`, safe `message`, `retryable`, and `suggested_action`. Retry only when `retryable` is true. `SLOT_NO_LONGER_AVAILABLE` means refresh availability. `MISSING_REQUIRED_GUEST_DATA` means collect the listed missing fields. `HOLD_EXPIRED` means start again with fresh availability.

## MCP tools

`search_restaurants`, `get_restaurant`, `refresh_availability`, `restaurant_reservation`, `hold_reservation`, `make_reservation`, `reservation_confirmation`, `modify_reservation`, and `cancel_reservation` are available at the Remote MCP endpoint. Mutation tools require trusted authorization and direct AI booking configuration.
