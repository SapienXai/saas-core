# Reservevia domains

Phase 6 adds one-deployment public hostname resolution without copying restaurant pages or creating one deployment per restaurant.

## Hostname model

```text
reservevia.com                    compatible platform root/listing
www.reservevia.com                permanent redirect to reservevia.com
app.reservevia.com                authentication and management
api.reservevia.com                future dedicated Agent REST API hostname
mcp.reservevia.com                future dedicated Remote MCP hostname
docs.reservevia.com               reserved future documentation hostname
{restaurant-slug}.reservevia.com  hosted restaurant page
customer-owned hostname           verified restaurant_domains mapping
```

The platform root remains the current compatible public listing for now. The future marketing site is a separate phase. `app.reservevia.com` is the preferred authenticated origin, but `/login`, `/signup`, `/onboarding`, and `/manage` remain available on the deployment for local and compatibility use.

Hosted URLs are derived from `restaurants.slug`. There is deliberately no `felix-beach.reservevia.com` row in the database. A slug change changes the hosted URL but does not change a customer-owned domain.

## Centralized classification and resolution

`lib/domains/hostname.ts` owns request-host classification and customer-domain normalization. It:

- accepts an optional `http(s)://` scheme and removes it;
- removes ports and a trailing dot;
- lowercases and uses the URL parser's ASCII/punycode hostname;
- rejects paths, queries, fragments, credentials, wildcard input, IP addresses, localhost customer input, invalid label lengths, and invalid label characters;
- rejects all Reservevia-owned hosts, including `reservevia.com`, `www.reservevia.com`, `app.reservevia.com`, and every `*.reservevia.com` host from the custom-domain flow.

The classifier distinguishes `PLATFORM_ROOT`, `PLATFORM_WWW`, `PLATFORM_APP`, `HOSTED_RESTAURANT`, `CUSTOM_RESTAURANT`, `LOCAL_DEVELOPMENT`, `VERCEL_PREVIEW`, and `UNKNOWN`. `felix-beach.localhost:3000` is treated as a hosted tenant for local testing. Vercel preview hosts are never stored as customer domains. `api`, `mcp`, and `docs` are reserved platform labels even before dedicated DNS is configured.

`lib/domains/public-resolver.ts` is server-only:

```text
request Host
  ├─ hosted slug → published restaurants.slug → PublicRestaurantProfile
  └─ custom host → restaurant_domains → restaurant → PublicRestaurantProfile
```

Custom rendering requires a local mapping with active status, provider verification, DNS readiness, a published restaurant, and `can(workspaceId, "customDomain")`. Public requests do not call Vercel. If a paid mapping becomes unavailable after downgrade or provider drift, the mapping is retained but the effective public URL falls back to the hosted slug URL.

## Database model and security

`restaurant_domains` is an additive Supabase migration. It contains:

- `restaurant_id` as the normalized ownership edge to `restaurants.workspace_id`;
- normalized lowercase hostname;
- `pending`, `verifying`, `active`, `error`, `removing`, `suspended`, and `removed` lifecycle state;
- provider/environment and verification/DNS state;
- safe timestamps and provider error codes/messages;
- creator and audit timestamps.

PostgreSQL enforces one row per restaurant and a globally unique lowercase hostname. Supabase RLS permits authorized workspace members to read their restaurant mappings, while insert/update/delete is server-controlled. Browser clients cannot mark a mapping verified, alter provider state, or change ownership. Domain actions repeat Owner/Admin authorization and the `customDomain` entitlement check before any provider call.

Free workspaces retain their hosted URL and cannot connect a custom domain. Starter, Pro, and Business can connect one domain per restaurant. Downgrades are non-destructive: configuration remains stored and the effective state is suspended/fallback until the workspace is entitled and provider state is revalidated.

## Vercel provider boundary

`lib/domains/vercel.ts` is server-only and uses the official `@vercel/sdk` 1.28.16 project-domain APIs for:

- adding a project domain;
- reading project-domain verification state;
- reading current DNS configuration and recommended A/CNAME values;
- attempting verification;
- removing a project domain.

Required server environment:

```text
RESERVEVIA_ROOT_DOMAIN=reservevia.com
RESERVEVIA_APP_DOMAIN=app.reservevia.com
VERCEL_API_TOKEN=server-only-token
VERCEL_PROJECT_ID=Reservevia-project-id
VERCEL_TEAM_ID=optional-team-id
```

No provider token is exposed to browser code. The provider never uses Vercel registrar/purchase APIs. If Vercel reports an existing domain, forbidden ownership, or another project assignment, Reservevia does not force-reassign it. The UI displays a controlled error and the official verification path.

The management path is `/manage/domains`. The add sequence is:

```text
Owner/Admin
  → normalize + validate hostname
  → check restaurant ownership + customDomain entitlement
  → check local uniqueness and one-domain-per-restaurant rule
  → add to the dedicated Reservevia Vercel project
  → save pending/verifying state
  → show Vercel verification/DNS instructions
  → Refresh Status
  → active only when provider verification and DNS readiness are true
```

Removal first uses the provider boundary and only deletes the local mapping after a successful provider removal. A failed removal remains retryable in an error state. `npm run domains:reconcile -- <restaurant-slug>` reads the provider state and updates local status; it never changes provider ownership based on stale local data.

Application-generated management links use `NEXT_PUBLIC_APP_URL` when configured, then the local site URL during development, and finally `https://app.reservevia.com`. The inherited Resend sender domain and Felix management contact remain compatibility configuration until Reservevia production email infrastructure is deliberately migrated; they are not used for public hostname resolution.

## Public and auth safety

`reservevia.com/` keeps the listing. A published hosted or custom tenant root renders the same `RestaurantLandingPage` used by `/r/[slug]`. A tenant-host `/r/other-slug` returns not-found. Tenant-host `/reserve` ignores `restaurantSlug` and legacy `restaurant` query values and uses the hostname restaurant. The server reservation action repeats this check before insertion, so custom domains cannot bypass quota, availability, notification, or tenant ownership.

Tenant-host `/manage`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/onboarding`, and `/auth/*` redirect to the trusted app origin in production. Public restaurant hosts do not receive management sessions or alternate auth origins. Unknown hosts never fall back to Felix, the first restaurant, or a default restaurant.

## DNS and rollout safety

The current public read-only DNS inspection found:

- authoritative nameservers: `launch1.spaceship.net`, `launch2.spaceship.net`;
- apex A records: `34.216.117.25`, `54.149.79.189`;
- no apex MX/TXT records returned by the lookup;
- no `www`, `app`, or wildcard answer observed.

No DNS or nameserver changes were made. Wildcard Vercel domains require careful DNS/nameserver planning. Before activation:

1. inventory every authoritative DNS record, including MX, SPF, DKIM, DMARC, TXT, CAA, and verification records;
2. confirm the dedicated Reservevia Vercel team/project and current project domains;
3. add `reservevia.com`, `www.reservevia.com`, `app.reservevia.com`, and the wildcard domain according to the current Vercel project configuration;
4. preserve or recreate all required email and verification records at the selected DNS provider;
5. use Vercel's exact A/CNAME/TXT instructions; wildcard domains use the Vercel nameserver method;
6. verify root redirect, app host, two different restaurant slugs, HTTPS/SSL, and auth redirects;
7. verify email DNS and other unrelated records still work;
8. only then enable production customer-domain onboarding.

Nameserver changes are manual infrastructure work and are not automated by this repository.

## Local and preview testing

Use the local Supabase environment and send a `Host` header to the Next.js server:

```bash
felix-beach.localhost:3000/
felix-beach.localhost:3000/reserve
localhost:3000/r/felix-beach
```

The unit suite covers classification and normalization. Local Supabase integration coverage validates domain RLS, blocked browser writes, hostname uniqueness, and one mapping per restaurant. Real Vercel API, wildcard DNS, and customer-owned-domain E2E were not claimed because no authorized Reservevia Vercel project/token and no safe owned test domain were available.
