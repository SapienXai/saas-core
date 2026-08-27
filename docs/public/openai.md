# OpenAI Restaurant Reservations

ReserveVia implements the current OpenAI Restaurant Reservation Conversion shape as an integration surface, subject to external partner approval and configuration.

## Components

- Business feed: `/api/v1/businesses` with stable restaurant UUIDs, pagination, opaque page/change tokens, and checksum.
- MCP endpoint: `/api/mcp`.
- Exact bootstrap tool: `restaurant_reservation`.
- Widget resource: `ui://widget/restaurant-reservation.html`.
- OpenAPI: `/openapi.json`.

The `restaurant_id` in a business record resolves to the exact same restaurant through `restaurant_reservation`. ReserveVia does not claim OpenAI approval automatically.

## Booking boundary

The basic restaurant reservation flow can open the widget while direct AI booking remains disabled. Direct mutation tools require `AI_DIRECT_BOOKING_ENABLED=true`, trusted client authorization, explicit confirmation, idempotency, and scoped management tokens.

## External configuration

DNS for `api.reservevia.com` and `mcp.reservevia.com`, production credential configuration, OAuth 2.1 authorization-resource metadata, OpenAI partner onboarding, and production feed registration remain deployment tasks.
