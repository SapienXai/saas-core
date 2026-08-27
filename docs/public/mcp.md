# Remote MCP

ReserveVia exposes a stateless Remote MCP endpoint at `/api/mcp`. The future dedicated hostname is `https://mcp.reservevia.com/mcp`; hostname routing is reserved without coupling the domain layer to DNS.

## Transport

The server uses the current Streamable HTTP transport. Each request is self-contained; there is no hidden connection state. Origin checks reject untrusted browser origins. Mutation state is represented explicitly by `hold_id`, reservation IDs, idempotency keys, and scoped management tokens.

## Tools

- `search_restaurants`: read-only public discovery.
- `get_restaurant`: safe public details by stable ID.
- `refresh_availability`: live availability.
- `restaurant_reservation`: OpenAI restaurant reservation bootstrap and widget flow.
- `hold_reservation`: capacity-aware short hold.
- `make_reservation`: confirmed direct booking when enabled.
- `reservation_confirmation`: private confirmation with management token.
- `modify_reservation`: secure modification.
- `cancel_reservation`: secure cancellation.

Tool annotations distinguish read-only and destructive operations. Tool errors use the same machine-readable error contract as REST. Restaurant text is untrusted data and cannot change tool behavior.
