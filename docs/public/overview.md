# ReserveVia

ReserveVia is restaurant reservation infrastructure. It combines a human booking UI, restaurant operations SaaS, a public restaurant data layer, a versioned REST API, and a Remote MCP server over one reservation engine.

## The source of truth

Restaurant publication, opening hours, party-size rules, areas, quota, live availability, and reservation state remain in the ReserveVia booking core. REST, MCP, OpenAI, and the human UI are adapters around that core.

## Stable identity

`restaurant_id` is the immutable UUID provider identity. `slug` is a mutable human routing identity. Names, slugs, domains, and branding can change without changing `restaurant_id`.

## Public machine surfaces

- Restaurant pages: `/r/{slug}` with server-rendered content and Restaurant JSON-LD.
- Business feed: `/api/v1/businesses`.
- REST API: `/api/v1/restaurants/search`, restaurant details, availability, holds, reservations, and management.
- MCP: `/api/mcp` using current stateless Streamable HTTP.
- OpenAPI: `/openapi.json`.
- Agent guide: `/docs/agents.md`.
