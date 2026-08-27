# Reservevia architecture

This is the implemented Phase 10A foundation. It is a multi-tenant reservation monolith with a validated local Supabase lifecycle, current SSR authentication, self-service account bootstrap, a unified public restaurant profile, database-backed commercial entitlements, a Paddle Billing adapter that is sandbox-ready, centralized hosted/custom hostname resolution, secure team invitations, restaurant-scoped management access, a workspace-branded management PWA, restaurant-aware Web Push delivery, a platform marketing/pricing front door, production-safe reservation idempotency/rate limiting, security headers, and a schema-only fresh-cloud bootstrap. Paddle is a payment provider, not the runtime authorization source. Cloud staging, production DNS activation, Paddle Live, and final launch remain deferred.

## Stack and runtime

- Next.js 16.3.0 App Router, React 19.2, TypeScript 5.9 strict mode
- Tailwind CSS and Radix/shadcn-style components
- Supabase PostgreSQL, Auth, Realtime, and Storage
- Server-side service-role access for existing server actions, with centralized application authorization and database RLS as defense in depth
- Resend email, Web Push, and the existing management service worker/offline shell
- Node 24 LTS, pnpm 11.21.0, and one committed `pnpm-lock.yaml`
- Vitest for domain, authorization, profile, and local Supabase integration tests
- Database-owned plans, workspace subscription state, usage periods, and atomic reservation quota enforcement
- Official `@paddle/paddle-node-sdk` and `@paddle/paddle-js` pinned for server checkout, lifecycle synchronization, and overlay checkout
- Official `@vercel/sdk` 1.28.17 in a server-only provider boundary for project-domain operations
- `@supabase/ssr` browser/server clients with proxy cookie refresh and PKCE confirmation links

Next.js and `eslint-config-next` are aligned on 16.3.0. Node.js 24 is the project runtime and pnpm 11 is pinned in `package.json`. `vaul` remains on React 19-compatible 1.1.2.

## Database lifecycle

The historical Felix-compatible scripts in `scripts/sql/001-017` are preserved as the operational record. They are not a complete clean-install lifecycle, so local Supabase resets use this forward sequence:

1. `202608090000_felix_legacy_baseline.sql` creates the current Felix-compatible schema and deterministic local Felix rows. It is a development reset baseline, not a production-data migration.
2. `202608090001_workspace_schema.sql` adds workspaces, membership, and nullable restaurant ownership.
3. `202608090002_backfill_felix_workspace.sql` creates `Felix Restaurants`, assigns the exact inherited Felix restaurants, bridges existing profiles, validates ownership, and makes `restaurants.workspace_id` required.
4. `202608090003_workspace_rls.sql` installs workspace-aware RLS policies and helper functions.
5. `20260809151152_restaurant_profile_foundation.sql` adds profile columns, deterministic slugs, publication state, hardened helper permissions, and the `restaurant-assets` Storage bucket/policies.
6. `supabase/seed.sql` adds only local `Test Restaurant Group` fixtures after migrations.
7. `20260809155804_plans_subscriptions_and_usage.sql` adds the authoritative plan catalog, workspace subscription state, usage periods, and Free defaults. Felix Restaurants is assigned Business as a grandfathered development state.
8. `20260809155856_usage_quota_and_commercial_rls.sql` adds commercial RLS, atomic reservation usage/quota enforcement, and concurrency-safe restaurant/member creation limits.
9. `20260809165536_paddle_billing_foundation.sql` adds environment-specific Paddle price mappings, provider fields on workspace subscriptions, a durable webhook inbox, and server-controlled checkout request state. It also reloads the PostgREST schema cache after the additive columns are introduced.
10. `20260809190337_custom_restaurant_domains.sql` adds one server-managed customer-domain mapping per restaurant, globally unique normalized hostnames, provider/verification state, and authenticated read-only RLS.
11. `20260809202646_team_multi_restaurant.sql` adds restaurant-scoped membership access, normalized member/invitation restaurant assignments, hashed expiring invitations, seat-aware transactional invitation/acceptance/member-update RPCs, and matching RLS.
12. `20260809214318_pwa_push_foundation.sql` adds workspace PWA settings, workspace/user/device push subscriptions, legacy push-row migration, entitlement-aware PWA/push RLS, and the tenant-safe workspace icon Storage path.
13. `20260810120000_public_reservation_safety.sql` adds bounded public reservation input validation support, tenant-scoped idempotency keys, and an atomic short-window reservation abuse limiter. The limiter is service-role-only and never exposes its state to anonymous clients.
14. `20260813130000_claimable_restaurants.sql` adds private claim profiles, hashed claim and reservation-management tokens, server-validated platform import batches, atomic provisioning/claim RPCs, and additive dependencies/backfill that keep existing restaurants claimed.

Run the lifecycle with:

```bash
pnpm run db:start
pnpm run db:reset
pnpm run db:test
```

The local project uses ports 54521–54524 and the test runner refuses non-local URLs. Local resets intentionally retain the Felix-compatible development baseline and synthetic fixtures. A new cloud Reservevia environment must instead apply the schema-only artifact and production catalog in `supabase/bootstrap/`; that workflow is described in [`docs/PRODUCTION.md`](PRODUCTION.md) and [`supabase/bootstrap/README.md`](../supabase/bootstrap/README.md). No cloud Reservevia project was created in this phase, and no FelixRez project or credentials are used.

## Ownership model

```text
User
 │
 └── Workspace Membership
       │
       ▼
    Workspace
       │
       ├── Restaurant
       │      └── Reservations
       │
       └── Restaurant
              └── Reservations
```

- `workspaces`: customer/account boundary, unique slug, active/archived status
- `workspace_members`: unique `(workspace_id, user_id)`, roles `owner`, `admin`, `manager`, `staff`, with legacy `readonly`, plus `restaurant_access_mode` (`all` or `selected`)
- `workspace_member_restaurants`: normalized selected restaurant access for Manager/Staff members
- `workspace_invitations` and `workspace_invitation_restaurants`: expiring hashed-token invitations and normalized access intent
- `restaurants.workspace_id`: required tenant owner after the backfill
- `reservations.restaurant_id`: normalized reservation ownership; workspace is derived through restaurant
- Child tables such as areas, media, notification settings, and push subscriptions remain restaurant-owned
- Platform-created claimable restaurants use the same existing workspace boundary; claiming adds an owner membership and never changes `restaurants.workspace_id`.
- Private acquisition tables are service-role-only. Public restaurant projections expose only a derived claimable CTA, never business-contact or token data.

Subscription ownership belongs to `workspaces` through `workspace_subscriptions`. Paddle identifiers, status, billing periods, and cancellation state are synchronized into that row, while `lib/entitlements.ts` remains the runtime source for features and limits. Free has no Paddle subscription. Felix remains a system/Business grandfathered workspace and is not attached to Paddle by seed data.

## Plans, entitlements, and usage

`public.plans` is the single source of truth for the four active plans: `free`, `starter`, `pro`, and `business`. It owns prices, restaurant/user limits, nullable unlimited reservation/history limits, and the feature JSON object. TypeScript defines only the allowed feature/limit keys and loads the catalog from Supabase.

`workspace_subscriptions` gives every workspace an explicit current plan. New workspaces receive Free through a database trigger. The inherited `felix-restaurants` workspace is Business in the migration/seed environment so its four existing restaurants and existing notification/report behavior are preserved; Business limits apply only to new resources. No runtime code has a Felix-specific plan branch.

`workspace_usage_periods` stores a workspace period and successful reservation count. Free/manual periods use the calendar month; future Paddle synchronization can set actual subscription periods. A private `BEFORE INSERT` trigger locks or creates the usage row, checks the plan's reservation limit, increments atomically, and rolls back with a failed reservation insert. Cancellations and status changes do not decrement usage. Pro and Business still record usage, but their nullable limit is unlimited.

The server entitlement service in `lib/entitlements.ts` exposes typed `can`, `getLimit`, `getUsage`, `getRemaining`, `getHistoryCutoff`, `assertFeature`, and `assertWithinLimit` operations. Application actions use these helpers for restaurant/member creation and notification behavior. The database triggers remain authoritative for direct Supabase inserts and races.

History is access control, not data retention: old reservations remain stored, while management reservation and report reads apply the workspace cutoff. Future reservations remain visible. RLS protects commercial tables from normal client writes; only authorized members can read their workspace subscription/usage, and the plan catalog is safe to read.

Free keeps core booking and profile functionality, includes reservation email delivery, keeps push delivery entitlement-controlled, retains subtle hosted-page Reservevia branding, and allows 100 reservations per current period. Starter keeps email delivery and allows 500 reservations; Pro and Business enable unlimited reservation usage and their catalogued advanced capabilities. Plan & Usage is available at `/manage/plan`; `npm run dev:set-plan -- <workspace-slug> <plan>` is local-development-only.

Paddle billing is layered on top of this state. `billing_provider_prices` maps `(provider, environment, plan, month, USD)` to Paddle product/price IDs. The server derives the workspace and approved mapping; browser input cannot select a workspace or provider price. `PADDLE_API_KEY` and `PADDLE_WEBHOOK_SECRET` remain server-only, while only the Paddle client token is returned to the checkout component.

## Roles and compatibility

`workspace_members` is the authoritative source for workspace authorization. `admin_profiles` remains for profile metadata, legacy restaurant assignment, and existing push/UI compatibility. The Phase 1 bridge maps legacy `admin` to workspace `owner` and preserves `manager`, `staff`, and `readonly` names.

Owners and admins have workspace-wide access. Managers and staff retain operational access only for their assigned restaurants; `all` and `selected` access modes are resolved centrally. Owners/admins are the only team managers: owners may invite/manage Admin, Manager, and Staff, while admins may invite/manage Manager and Staff but cannot create, demote, or remove an Owner or administer billing. Staff and readonly never receive team or billing mutation authority. The detailed lifecycle is documented in [TEAM-AND-MULTI-RESTAURANT.md](TEAM-AND-MULTI-RESTAURANT.md).

Future cleanup must remove contradictory role semantics only after all consumers and production data are migrated.

## Authorization and RLS

`lib/authorization.ts` centralizes authentication, workspace access, role checks, restaurant access, management access, and reservation access. Server actions treat browser IDs as selectors, never as proof of ownership.

RLS follows:

```text
auth.uid()
  ↓
workspace_members
  ↓
workspaces
  ↓
restaurants
  ↓
restaurant-owned records
```

RLS is enabled on workspaces, memberships, restaurants, media, notification settings, areas, reservations, admin profiles, push subscriptions, and Storage objects. Public listing, slug resolution, and booking use server-only service-role reads with explicit public fields; management writes still perform application authorization first.

The Phase 2 migration restricts anonymous execution of the Phase 1 security-definer helpers and prevents a caller from using their optional user argument to inspect another user. The local integration suite creates two authenticated users, verifies own/foreign workspaces, restaurants, reservations, areas, settings, media, push subscriptions, forged writes, and Storage asset paths.

## Restaurant profile

The `restaurants` row is the single source of truth. Existing reservation settings stay on the restaurant model; the public profile adds:

- `slug` — stable, globally unique public identifier
- `logo_url` — one logo
- `primary_image_url` — one primary/banner image
- `whatsapp`, `menu_url`, `location_url`, `events_url`
- `timezone`, `language`
- `status` — `published` or `unpublished`

The legacy `restaurant_media` table remains for compatibility, but the new public experience selects only `primary_image_url`. The migration promotes the first image asset for inherited restaurants and deliberately does not promote Felix Garden's video to an image.

## Assets

Restaurant images use the `restaurant-assets` Supabase Storage bucket. Public reads are limited to intentionally public image objects. Authenticated uploads, replacements, and deletes require owner/admin/manager membership and a path shaped like:

```text
workspace-id/restaurant-id/logo/file.ext
workspace-id/restaurant-id/primary/file.ext
```

The profile editor validates image MIME types and a 5 MB limit. The service-role key is never sent to the browser. Replacements delete the prior object after the profile update succeeds.

## Slugs and public resolution

`lib/restaurant-profile.ts` owns slug generation and validation. Slugs are lowercase, URL-safe, stable after creation, and protected from platform names such as `www`, `app`, `api`, `admin`, `manage`, `login`, `signup`, `pricing`, `help`, `support`, `status`, `mail`, `assets`, and `static`.

Existing Felix slugs are deterministic (`felix-beach`, `felix-garden`, `felix-marina`, `felix-selimiye`). Name changes do not silently change a slug. Server-side profile updates check collisions and reserved values.

`fetchPublicRestaurantProfileBySlug` is the shared resolver:

```text
slug → published restaurant → safe public profile view
```

It excludes workspace membership, internal settings, private notes, billing, notifications, and reservation configuration from the `PublicRestaurantProfile` object.

## Public experience

`RestaurantCard` and `RestaurantLandingPage` both consume `PublicRestaurantProfile`. The listing at `/` uses the card. The canonical internal standalone route is `/r/[slug]`, with restaurant-specific metadata and an Open Graph image when the profile has one.

The experience is mobile-first, server-resolved, and intentionally limited to one image and one logo. Optional Menu, Location, Events, WhatsApp, and Call actions disappear when their profile values are empty. Reserve Table is the dominant action.

`/reserve?restaurantSlug=...` is the new canonical CTA. `/reserve?restaurant=...` remains supported for existing links, and both resolve through the existing reservation engine. Hosted tenant hosts and verified custom domains lock reservation context to the hostname; root-domain query parameters remain backward-compatible. Wildcard DNS and production project-domain activation are still infrastructure-pending.

## Domains and hostname resolution

The public request model is one deployment and one renderer:

```text
reservevia.com                         → compatible platform root/listing
www.reservevia.com                     → permanent redirect to root
app.reservevia.com                     → auth/management origin
{restaurant.slug}.reservevia.com       → published restaurant profile
customer-owned hostname                → restaurant_domains → restaurant profile
```

Hosted subdomains are derived directly from the stable, globally unique `restaurants.slug`; there is no duplicate hosted-domain row. Customer-owned domains use `public.restaurant_domains`, which stores a normalized lowercase ASCII/punycode hostname, one row per restaurant, and provider lifecycle state. The database has a unique hostname index and a unique restaurant constraint so concurrent attachments cannot create aliases or cross-restaurant conflicts.

`lib/domains/hostname.ts` is the only hostname normalization/classification boundary. It strips schemes, ports, and trailing dots, rejects paths/query/fragments, IPs, wildcards, localhost customer input, invalid labels, and all Reservevia-owned hostnames. `classifyHostname` distinguishes platform root/www/app, hosted tenant, local tenant, Vercel preview, custom, and unknown hosts.

`lib/domains/public-resolver.ts` is server-only. It derives a hosted slug without a provider call and resolves custom hosts through the local verified mapping. It only returns the existing `PublicRestaurantProfile`, never internal workspace/billing/settings fields. Active custom rendering additionally requires provider verification, DNS readiness, publication, and `can(workspaceId, "customDomain")`. Suspended or no-longer-entitled mappings retain their data but fall back to the hosted slug URL. Public requests never call Vercel, so provider outages cannot break a published restaurant page or reservation flow.

`lib/domains/public-url.ts` is the centralized URL service. It prefers `https://custom-host` only for an active verified entitled mapping; otherwise it returns the hosted URL. Local development falls back to `/r/[slug]`, while production uses `https://slug.reservevia.com`. Restaurant metadata uses the same canonical URL service.

Tenant hosts cannot become alternate management/authentication origins. Middleware redirects `/manage`, `/login`, `/signup`, `/onboarding`, and related auth routes to the trusted app origin in production; local `*.localhost` testing keeps direct routes. `app.reservevia.com/` enters the existing account-state resolver. Hosted/custom `/r/[other-slug]` requests return not-found, and hosted/custom `/reserve` ignores forged restaurant query parameters. The server-side reservation action repeats the hostname ownership check before insertion.

Custom-domain management is at `/manage/domains`. Owner/Admin authorization and the `customDomain` entitlement are checked server-side. Provider writes are performed only by `lib/domains/vercel.ts`; browser clients cannot mark domains verified, change provider state, or mutate the mapping through Supabase. Vercel returns the actual verification/DNS requirements, which the UI displays. No force reassignment is implemented. `npm run domains:reconcile -- <restaurant-slug>` is a guarded support command.

## Management PWA and Web Push

The PWA belongs to the workspace and runs only on the trusted management origin `app.reservevia.com`; it is not installed from guest restaurant hosts. `workspace_pwa_settings` stores only an optional app name, one public-safe icon URL, and validated theme/background colors. `lib/pwa.ts` derives effective branding from custom settings, the single restaurant logo, the restaurant primary image when no logo exists, the workspace, and a Reservevia fallback. Pro/Business `customPWA` controls branded configuration; the normal management web app remains available on every plan.

`GET /manifest.webmanifest` is dynamic, private/no-store, and host-gated. The management layout includes the authenticated workspace as a manifest preference, and the route accepts it only after membership validation. Its stable ID is `/pwa/{workspace-id}`, its start URL is a validated management preference, and its scope is the management origin. `/manage/pwa` owns install guidance, Owner/Admin branding controls, and explicit per-device push controls. Free/Starter can use the browser management app but do not receive paid branding/push controls.

`workspace_push_subscriptions` is the current user/workspace/device table. Legacy `admin_push_subscriptions` rows are migrated when resolvable; new registration and delivery use the workspace table. `getPushRecipientsForRestaurant` re-evaluates current membership and selected restaurant assignments at delivery time, so a removed member or assignment stops future notifications without copying access lists into device rows. Push payloads contain only restaurant/date/time/party-size operational context and same-origin management paths. Web Push failure is isolated from reservation creation, while dead endpoints are revoked.

The management service worker caches only versioned static assets. It network-fetches management navigation and returns a generic tenant-free offline response; it does not cache reservation/customer HTML or data, APIs, auth, Server Actions, reports, billing, domains, or team data. Logout clears legacy client keys, deletes Reservevia management caches, revokes the user’s server subscriptions, and unsubscribes the active browser endpoint where possible. The full boundary is documented in [PWA-AND-PUSH.md](PWA-AND-PUSH.md).

## Tests and quality

- Pure Vitest regression tests cover reservation validation, availability, blocked dates/intervals, authorization, slug rules, URL validation, and the public data boundary.
- Playwright browser tests cover signup/confirmation/onboarding, publishing and guest booking, Free quota blocking and upgrade CTA, workspace switching and tenant isolation, restaurant-scoped roles, unclaimed claims, customer reservation update/cancel, and mobile booking/onboarding layouts. Their reusable fixtures seed and destroy one deterministic scenario per test.
- `npm run db:test` runs real authenticated local Supabase RLS and Storage integration tests with service role used only for setup/cleanup.
- `pnpm run db:test:clean` resets the local database and runs the reservation lifecycle, quota/concurrency, self-service limits, RLS, team, claimable, and subscription integration suites. The scenario factory is local/dev-only and never targets production data.
- The local reset has been executed from zero through all migrations and seed data, including `restaurant_domains`.
- Lint passes with two existing warnings in `app/manage/reports/page.tsx`.
- Typecheck passes.
- Production build passes when run with the isolated local Supabase variables; the known Realtime critical-dependency warning remains.
- Hostname unit tests cover platform, local, preview, hosted, custom, Unicode/punycode, unsafe input, and reserved hosts. Local RLS tests cover tenant domain reads, blocked browser writes, duplicate hostnames, and one-domain-per-restaurant constraints. Route smoke tests cover hosted rendering, cross-tenant `/r` isolation, hostname-locked reservation URLs, and app-host redirect behavior.
- Paddle unit tests cover raw-body signature verification with the official SDK, event normalization, status mapping, and safe event metadata. Local integration tests cover provider-table RLS, server-controlled mappings, subscription lifecycle synchronization, past-due retention, cancellation to Free, and out-of-order delivery.
- Team integration tests cover hashed invitations, pending-seat reservation, role hierarchy, wrong-email and replay rejection, direct-write blocking, selected restaurant RLS, transactional member-scope updates, Business restaurant-limit concurrency, and cross-restaurant isolation.
- `tests/ai/tool-selection-cases.json` is a non-executable AI-evaluation fixture; executable Vitest tests remain under `test/`, avoiding a duplicate test hierarchy.
- PWA/push tests cover management-origin gating, no-sensitive-data service-worker policy, PWA/push RLS, generated local types, and recipient resolution for Owner/Admin/all/selected restaurant scopes.
- Marketing tests cover platform/app/tenant host separation, plan-catalog pricing presentation, feature accuracy, and canonical signup/login CTA origins.

## Paddle billing boundary

```text
Owner → server-authorized checkout → Paddle Checkout
                                  ↓
Paddle webhook → raw-body signature verification
               → billing_webhook_events inbox/idempotency
               → workspace_subscriptions
               → lib/entitlements.ts
```

`POST /api/billing/paddle/webhook` accepts only signed POSTs. Events are normalized before minimal storage, processed at most once per provider event ID, and guarded by `last_provider_event_at` so older notifications cannot overwrite newer state. Active, trialing, and past-due subscriptions keep the purchased plan; paused and canceled subscriptions resolve to Free. A scheduled cancellation retains paid access until Paddle reports the effective cancellation. A past-due state shows an owner warning but does not interrupt reservations.

Owner-only server actions create checkout transactions, open temporary Customer Portal sessions, preview and submit paid-to-paid changes using Paddle's proration modes, and schedule cancellation. Local entitlements never change from a checkout client event; only a verified webhook does so. `npm run billing:reconcile -- <workspace-slug>` is a guarded support command for repairing local drift from Paddle.

## Self-service authentication and onboarding

The canonical public auth routes are `/signup`, `/login`, `/forgot-password`, `/reset-password`, and `/auth/confirm`. `/manage/login` remains a compatibility route that redirects to the shared login screen. Browser code uses the singleton `createBrowserClient`; Server Components, Server Actions, and Route Handlers use `createServerClient` with async cookie access. Middleware calls `auth.getUser()` to refresh and validate the session before protecting `/manage` and `/onboarding`. No deprecated Supabase auth-helper package, custom JWT parser, or browser service-role credential remains in the active flow.

Signup uses email/password only. Confirmation and recovery links use checked-in token-hash email templates and `verifyOtp()` at `/auth/confirm`; a PKCE code exchange remains as a compatibility fallback. Recovery links are routed to `/reset-password`, while new confirmed accounts are routed through `/auth/continue` to determine whether they need onboarding or can enter management. Messages are intentionally neutral and do not enumerate accounts. Local email is captured by Mailpit at port 54524; production requires separate Supabase SMTP configuration and matching hosted email templates.

`getAccountState()` is the central account-state resolver. A user with no membership goes to onboarding. A user with an incomplete self-created workspace stays in onboarding. A completed self-created workspace or inherited/invited membership enters management. This is not a permanent one-user/one-workspace data model: the product only limits self-service creation to one workspace per creator while future invitations can add memberships.

The SECURITY DEFINER `public.bootstrap_initial_workspace` function is the one transactional bootstrap boundary. It derives identity from `auth.uid()`, takes an advisory lock, creates the workspace, owner membership, initial unpublished restaurant, and compatibility profile row, and relies on the existing workspace trigger for Free subscription assignment. A unique creator index and idempotent same-input retry prevent duplicate self-service workspaces/restaurants. It rejects unauthenticated calls, forged identity, reserved slugs, and a second self-created workspace. The browser never submits owner IDs or workspace ownership fields.

Onboarding has three resumable steps: restaurant name/slug, the existing unified restaurant profile and one-logo/one-primary-image upload, then optional links and publish. It writes directly to the same `restaurants` row consumed by `RestaurantCard`, `/r/[slug]`, and management profile editing. Draft rows remain unpublished; publishing sets the restaurant active/public and records `workspaces.onboarding_completed_at`. Optional fields and assets can be skipped, and progress is derived from saved tenant data so refresh/retry does not create a second profile. The initial reservation engine defaults are preserved rather than exposing advanced configuration during acquisition.

## Team and multi-restaurant management

`workspace_invitations` is the account-level invitation lifecycle. It stores normalized email, role, restaurant access mode, inviter, a SHA-256 token hash, seven-day expiry, and delivery/accepted/revoked state. `workspace_invitation_restaurants` stores selected access as normalized rows. Valid pending invitations reserve seats under the existing `plans.user_limit`; invitation creation and acceptance lock the workspace subscription row and recheck active members plus pending invitations.

`workspace_members` remains the authorization source. `restaurant_access_mode = all` is workspace-wide for Owner/Admin and explicitly granted all-scope members; `selected` uses `workspace_member_restaurants`. The access predicate is shared by `lib/auth-utils.ts`, `lib/authorization.ts`, Storage path checks, and RLS for restaurant-owned data. Existing members are backfilled to `all`, preserving Felix's inherited access.

Owner/Admin-only `/manage/team` provides invite, resend, revoke, role, scope, and remove operations. Invitation acceptance is a transactional authenticated RPC that checks the one-use token, expiry, current auth email, current seat limit, and selected restaurant ownership. Role/scope editing uses the transactional `update_workspace_member` RPC. Admins cannot manage Admins or Owners; Owners cannot be demoted or removed. Removing a member never deletes the global Auth user or memberships in other workspaces.

The management shell adds compact workspace and restaurant selectors only when multiple contexts exist. HttpOnly cookies persist preference, while every query/action revalidates membership and restaurant scope. Aggregate-capable dashboard/reservation/report reads use accessible restaurant IDs before querying; restaurant profile, domains, booking settings, and other settings remain specific to one authorized restaurant. Business Owner/Admin users can create additional unpublished restaurants through the existing creation action, subject to the centralized `multiRestaurant` entitlement, restaurant limit, global slug validation, and existing concurrency-safe trigger. Felix's four inherited restaurants remain intact and cannot be used to create a fifth.

## Vercel and DNS rollout state

The current official Vercel project-domain API is wrapped with `@vercel/sdk` methods for add, get, verify, DNS configuration, and remove. The provider is configured with `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, and optional `VERCEL_TEAM_ID`, all server-only. No valid Reservevia Vercel project credentials were available in this workspace, so no project was created, inspected through the API, or mutated. Vercel E2E is therefore pending.

Public DNS inspection was read-only. `reservevia.com` currently delegates to `launch1.spaceship.net` and `launch2.spaceship.net`, has A records `34.216.117.25` and `54.149.79.189`, and no apex MX/TXT records were returned by the public lookup. No `www`, `app`, or wildcard answer was observed. A future wildcard rollout must inventory all records with the authoritative DNS provider, preserve email/verification records if added later, add the Reservevia project/root/wildcard domains, and verify SSL before changing nameservers. Nameserver changes remain manual and explicitly out of this phase.

## Deferred phases

Live Paddle rollout, annual pricing, trials, coupons, Enterprise, add-ons, wildcard DNS activation, ownership transfer, per-restaurant role matrices, enterprise directory features, social login, CAPTCHA enforcement, advanced analytics, galleries, guest push, native apps, a custom-domain management PWA, and a CMS are intentionally outside this phase. Code-level domain resolution, custom-domain management, team lifecycle, multi-restaurant management, and the workspace management PWA are implemented, but dedicated Vercel project access, production wildcard activation, real device/provider validation, and production VAPID rollout remain controlled infrastructure tasks.
