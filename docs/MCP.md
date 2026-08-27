# Remote MCP

The MCP adapter is isolated in `lib/ai/mcp-server.ts` and served from `app/api/mcp/route.ts` using `@modelcontextprotocol/sdk` 1.30.0 and Web Standard Streamable HTTP. It creates a stateless server per request, validates browser origins, returns structured tool results, and uses explicit handles rather than hidden sessions.

Tools: `search_restaurants`, `get_restaurant`, `refresh_availability`, `restaurant_reservation`, `hold_reservation`, `make_reservation`, `reservation_confirmation`, `modify_reservation`, `cancel_reservation`.

The exact OpenAI widget URI is `ui://widget/restaurant-reservation.html`. Direct booking is off by default and must not be enabled without client scopes, idempotency, confirmation, and production authorization configuration.
