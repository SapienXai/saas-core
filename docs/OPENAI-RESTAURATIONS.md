# OpenAI Restaurant Reservation readiness

This document records code readiness only. ReserveVia does not claim external OpenAI approval.

| Item | Status |
| --- | --- |
| Stable business IDs | implemented and tested as existing restaurant UUIDs |
| Versioned business feed | implemented at `/api/v1/businesses` |
| Deterministic pagination/checksum | implemented with opaque signed tokens and feed revision |
| MCP Streamable HTTP | implemented at `/api/mcp` |
| `restaurant_reservation` tool | implemented |
| Widget resource | implemented at `ui://widget/restaurant-reservation.html` |
| Stable feed/tool ID mapping | implemented by UUID lookup |
| OpenAPI | implemented at `/openapi.json` |
| Production API hostname | requires DNS and deployment routing |
| Production MCP hostname | requires DNS and deployment routing |
| OAuth 2.1 authorization metadata | requires production identity-provider configuration |
| Business feed registration | requires external OpenAI configuration |
| Partner approval | requires OpenAI review; not claimed |

## Integration values

- Feed: `https://api.reservevia.com/v1/businesses` after DNS/configuration.
- MCP: `https://mcp.reservevia.com/mcp` after DNS/configuration; application-compatible path is `/api/mcp`.
- Tool: `restaurant_reservation`.
- Widget: `ui://widget/restaurant-reservation.html`.
- Test IDs: use local fixture UUIDs or staging-created published restaurants; never use guest records.
- Privacy: `/privacy`.
- Terms: `/terms`.

## Failure behavior

The feed excludes incomplete restaurants rather than returning invalid records. Live booking failures use stable machine errors. Direct AI booking remains disabled unless `AI_DIRECT_BOOKING_ENABLED=true` is set in a controlled environment.
