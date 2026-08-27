# AI discovery and SEO

Public restaurant pages are server-rendered at `/r/{slug}` and respect the existing hosted-subdomain/custom-domain resolver. JSON-LD is derived from visible public fields and includes `Restaurant`, `PostalAddress`, `GeoCoordinates` when present, `ReserveAction`, `acceptsReservations`, canonical URL, menu, logo, phone, cuisine, and safe sameAs links.

No static availability is emitted in structured data. Agents must call live availability.

`/sitemap.xml` is a sitemap index for pages, published restaurants, and docs. Unpublished, suspended, inactive, and plan-excluded restaurants are not exported. `robots.txt` explicitly allows `OAI-SearchBot` for public content while keeping model-training crawler policy separate.

`/llms.txt` supplements, but does not replace, robots, sitemaps, JSON-LD, REST, MCP, or OpenAPI.
