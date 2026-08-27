# Quickstart

Use discovery to resolve a restaurant before booking. Do not use a name as a reservation identifier.

## 1. Search

```http
GET /api/v1/restaurants/search?query=Harbor%20House&locality=Istanbul
```

## 2. Refresh live availability

```http
GET /api/v1/restaurants/00000000-0000-4000-8000-000000000001/availability?date=2026-08-15&party_size=4&preferred_time=20:00
```

## 3. Hold and confirm

Trusted clients send a bearer credential, a unique `Idempotency-Key`, and the required reservation scope. A hold is short-lived. Before creating a reservation, collect only the restaurant's required guest fields and obtain user confirmation.

```http
POST /api/v1/reservation-holds
Authorization: Bearer rv_live_REPLACE_ME
Idempotency-Key: hold-example-20260815-001
Content-Type: application/json

{"restaurant_id":"00000000-0000-4000-8000-000000000001","date":"2026-08-15","party_size":4,"preferred_time":"20:00"}
```

Availability is volatile. Refresh it immediately before a hold or reservation.
