# Reservevia SaaS migration

This document records the implemented Phase 10A foundation and the work deliberately left for later phases. Reservevia remains a modular monolith built from the FelixRez-compatible reservation product. Staging/bootstrap, environment separation, security review, and the deferred production cutover are tracked in [`docs/PRODUCTION.md`](PRODUCTION.md).

## 1. Current FelixRez baseline

The current application uses Next.js 16.3.0, React 19.2, TypeScript 5.9, Tailwind, Radix/shadcn-style components, Supabase PostgreSQL/Auth/Realtime/Storage, Resend, Web Push, and a management service worker. Existing product routes remain `/`, `/reserve?restaurant=...`, and `/manage`.

The inherited reservation engine, areas, blocked dates and intervals, availability rules, reports, seating, email hooks, push hooks, and management workflows remain in place. `scripts/sql/001-017` are preserved; local resets use the clean baseline and forward migrations under `supabase/migrations/`.

## 2. Reservevia product vision

Reservevia will provide a simple mobile-first restaurant reservation profile and an operational management application. The restaurant owner should enter profile data once. The same profile should power the multi-restaurant card and standalone restaurant page.

Paddle Sandbox checkout, webhook synchronization, owner-only plan management, and provider reconciliation are implemented on top of the Phase 3 plan/entitlement foundation. Self-service email/password signup, confirmation, password recovery, first-workspace bootstrap, and resumable onboarding are implemented. Code-level hosted/custom domain resolution and management, secure team invitations, restaurant-scoped access, workspace/restaurant context, Business restaurant creation, workspace-branded management PWA, restaurant-scoped Web Push delivery, and the platform marketing/pricing front door are implemented; Vercel project activation, wildcard DNS, Paddle Live rollout, production VAPID/device rollout, and launch hardening are not.

## 3. User → Workspace → Restaurant model

```text
User
  ↓
Workspace Membership
  ↓
Workspace / Brand
  ↓
Restaurants
  ↓
Reservations
```

Workspace is the future customer and subscription boundary. Users may belong to multiple workspaces. Restaurants belong to exactly one workspace. Reservations remain attached to one restaurant, so workspace ownership is derived through `reservation → restaurant → workspace`.

## 4. Multi-tenancy and RLS

`workspace_members` is authoritative for workspace authorization. `admin_profiles` is a temporary compatibility bridge for display data, legacy restaurant assignment, and push/UI behavior. Application authorization in `lib/authorization.ts` and Supabase RLS both protect tenant boundaries.

The local integration matrix proves that authenticated users cannot read or write another workspace's workspace row, restaurant, reservation, area, settings, media, push subscription, or Storage path. It also covers forged IDs and permitted same-tenant reservation operations.

## 5. Restaurant profile and public pages

The `restaurants` row now includes one stable global `slug`, one `logo_url`, one `primary_image_url`, description, cuisine, atmosphere, hours, phone, WhatsApp, menu/location/events links, timezone, language, and publication state. Legacy `restaurant_media` remains for compatibility but is not a gallery in the new public model.

`lib/restaurant-profile.ts` owns slug normalization, reserved names, URL validation, and the `PublicRestaurantProfile` boundary. `fetchPublicRestaurantProfileBySlug` resolves only published rows and returns only fields needed by public UI.

The listing uses the reusable `RestaurantCard`. The same profile feeds `/r/[slug]` through `RestaurantLandingPage`. Both hide empty optional actions, use one image, and keep Reserve Table primary. `/reserve?restaurantSlug=...` is canonical for new links; the legacy `restaurant` name query remains compatible.

## 6. Public asset storage

`restaurant-assets` is a public-read image bucket for intentionally public logo/primary assets. Writes require authenticated owner/admin/manager membership and the scoped path `workspace-id/restaurant-id/{logo|primary}/file`. The profile editor enforces image-only MIME types and a 5 MB limit and removes replaced objects after a successful profile update.

## 7. Reservation engine

No booking algorithm rewrite was introduced. Existing public creation and management updates continue to use the reservation engine and its availability validation. Public customers do not need workspace membership; the server resolves the published restaurant and reservation areas for the requested slug/name.

## 8. Roles and RBAC

Roles are `owner`, `admin`, `manager`, `staff`, and temporary `readonly`. Owner/admin/manager may update the public profile; staff and readonly do not receive profile administration. Fine-grained permissions remain deferred.

## 9. Plans

The intended plans remain documentation only:

- Free: $0, 1 restaurant, 1 user, 100 reservations/month, 30-day history, hosted page, basic analytics
- Starter: $19, 1 restaurant, 3 users, 500 reservations/month, 365-day history, custom domain, email, CSV, and branding controls
- Pro: $49, 1 restaurant, 10 users, unlimited reservations/history, guest history, advanced reports, custom PWA and push
- Business: $99, 3 restaurants, 20 users, unlimited reservations/history, multi-restaurant management and all Pro capabilities

These definitions are stored in the database `plans` catalog. `workspace_subscriptions` gives every workspace an explicit current plan. New workspaces default to Free through a database trigger. Felix Restaurants is a migration-only grandfathered Business workspace so its four existing restaurants remain operational; no existing resource is deleted when a workspace is over a later plan limit.

## 10. Entitlements and usage

The billing-independent Phase 3 foundation centralizes capabilities and limits:

```text
can(workspace, feature)
getLimit(workspace, limit)
getUsage(workspace, metric)
```

`lib/entitlements.ts` is the centralized server boundary. It loads capabilities and limits from the workspace's local subscription and catalog rows and exposes `can`, `getLimit`, `getUsage`, `getRemaining`, `getHistoryCutoff`, `assertFeature`, and `assertWithinLimit`. Runtime code does not compare plan names for product decisions.

`workspace_usage_periods` stores current usage periods. Free/manual workspaces use calendar months; future billing synchronization can set actual period dates. Every successful reservation insert increments usage through a private, security-definer PostgreSQL trigger that locks the usage row and rejects a limit breach in the same transaction. This prevents concurrent inserts from producing usage 101 on Free or 501 on Starter. Cancellations and failed inserts do not refund/consume usage respectively; unlimited plans still record usage.

Restaurant and member creation use application checks plus database triggers. History access is non-destructive: reservations stay stored, while management reservation and report reads apply plan cutoffs and retain all future reservations. Commercial tables are RLS-protected; members can read only their workspace subscription/usage, and ordinary clients cannot mutate plans or counters.

Email and push calls occur only after a reservation succeeds. Reservation email delivery is available on every plan; push delivery remains entitlement-controlled. Provider failure never rolls back the reservation. Free hosted pages keep a subtle Reservevia credit; paid plan branding capability hides it. Plan & Usage is available at `/manage/plan`. The local-only `npm run dev:set-plan -- <workspace-slug> <plan>` script supports development matrix testing without exposing a production plan-change API.

## 11. Paddle billing

Implemented flow:

```text
Owner → server-authorized Paddle transaction → Paddle Checkout
Paddle webhook → raw-body signature verification → inbox/idempotent processing
  → workspace_subscriptions → Reservevia entitlements
```

Subscription belongs to workspace, not user or restaurant. `billing_provider_prices` is the environment-specific mapping for Starter, Pro, and Business monthly prices; Free has no provider price. The webhook route is `POST /api/billing/paddle/webhook`. It verifies the exact raw body with `Paddle-Signature` and `PADDLE_WEBHOOK_SECRET`, stores only normalized event data, and processes in a durable database-backed step. Checkout completion in the browser is UX-only. Active, trialing, and past-due retain the purchased entitlement; paused/canceled resolve to Free; scheduled cancellation retains paid access until effective cancellation. Customer Portal sessions are created fresh and temporary.

Use `npm run billing:register-price -- starter sandbox <product-id> <price-id>` only against the isolated local database. Use `npm run billing:reconcile -- <workspace-slug>` only as a guarded server-side support operation with the matching Paddle environment configured.

## 12. Domains

Implemented hostname structure:

```text
reservevia.com                    compatible platform root
www.reservevia.com                permanent root redirect
app.reservevia.com                management/auth origin
{restaurant-slug}.reservevia.com  hosted restaurant page
custom customer domain             paid feature
```

Hosted URLs use `restaurants.slug` as their only source of truth. `restaurant_domains` is reserved for customer-owned domains and enforces one mapping per restaurant plus global normalized-host uniqueness. `lib/domains/hostname.ts` classifies normalized request hosts; `lib/domains/public-resolver.ts` resolves hosted slugs or verified custom mappings to the same `PublicRestaurantProfile` used by `/r/[slug]`. `lib/domains/public-url.ts` chooses an active entitled custom URL or the hosted fallback.

Tenant hosts cannot use query parameters to switch reservation context. `/reserve` and the server reservation action both lock the restaurant to the request hostname. Tenant management/auth routes redirect to `app.reservevia.com`; the existing direct paths remain available for local/compatibility use. Unknown or unpublished custom hosts return a safe not-found response, while suspended/no-longer-entitled mappings fall back to the hosted URL without deleting configuration.

`/manage/domains` provides the minimal Owner/Admin add, refresh, and remove experience. It uses the `customDomain` entitlement and a server-only `@vercel/sdk` provider. Vercel supplies verification/DNS records; Reservevia does not force-reassign a domain. `npm run domains:reconcile -- <restaurant-slug>` is a guarded support command. No valid Reservevia Vercel credentials were available during Phase 6, so Vercel E2E and wildcard activation remain pending.

## 13. Notifications and PWA

Reservation email delivery is available on every plan; `emailNotifications` remains in the catalog for compatibility and plan visibility. Phase 8 adds the workspace-level `workspace_pwa_settings` and `workspace_push_subscriptions` tables. `customPWA` gates Owner/Admin branding configuration; `pushNotifications` gates explicit per-member/device registration and delivery. The manifest is dynamic and host-gated to the management origin. The service worker caches only static assets and always network-fetches management data, returning a generic offline response without tenant content. Push recipients are resolved from current workspace membership and restaurant assignments at delivery time, with minimal lock-screen payloads and no guest contact details. Legacy push rows are migrated when resolvable and retained temporarily for compatibility. See [PWA-AND-PUSH.md](PWA-AND-PUSH.md).

## 14. Multi-restaurant management

Phase 7 makes the existing multi-tenant promise operational. `workspace_invitations` stores normalized email, role, access mode, seven-day expiry, and a SHA-256 token hash. Pending non-expired invitations count as seats. Owner/Admin invitation creation locks the workspace subscription row, rechecks the current plan user limit, validates selected restaurant IDs, and inserts the invitation plus access assignments in one transaction. Acceptance locks the same commercial boundary, rechecks the authenticated email and current user limit, creates membership and selected assignments, marks the invitation accepted, and cannot be replayed.

The membership access model is workspace role plus restaurant scope, not a per-restaurant role matrix. Owners/Admins are workspace-wide. Managers/Staff are `all` or `selected`, with `workspace_member_restaurants` holding selected assignments. The same decision is used by server authorization, Storage path checks, and RLS for restaurants, reservations, areas, media/settings, push subscriptions, and domains. Existing members are backfilled to `all` so Felix behavior is unchanged.

`/manage/team` is Owner/Admin-only. Owners can manage Admin/Manager/Staff; Admins can manage Manager/Staff; neither can mutate the Owner. Invitation delivery is a separate Reservevia system email boundary and is not controlled by the restaurant reservation-email entitlement. Delivery failure leaves the invitation pending and resend rotates the token hash after a short cooldown. `/manage/users` redirects for compatibility.

Workspace and restaurant preferences are stored in validated HttpOnly cookies. A single-workspace/single-restaurant customer sees no extra switcher. Multi-workspace users can switch only to memberships they hold; multi-restaurant users see only accessible restaurants. Aggregate dashboard/reservation/report queries use server-scoped IDs, while settings/profile/domain pages require one authorized restaurant.

Business Owner/Admin users can create additional unpublished restaurants through the existing restaurant creation path. It reuses plan entitlements and the database restaurant-limit trigger, so Business can create only up to its catalog limit for new resources and Free/Starter/Pro cannot add a second. Felix's four inherited restaurants remain intact as grandfathered compatibility resources and cannot be deleted or disabled by the plan migration.

## 15. Production hardening

Before a cloud Reservevia launch, create a dedicated non-production Supabase project, apply migrations through a controlled release process, validate backups/RLS/rate limits, migrate auth/session integration to the current SSR pattern, configure a separate Vercel project, set domain/DNS boundaries, add monitoring, and perform a production-data migration review. FelixRez production remains outside this repository and must not be used for validation.

## 16. Self-service acquisition

The public acquisition flow is:

```text
/signup → confirmation email → /auth/confirm → /onboarding
        → atomic workspace + owner + Free + first restaurant bootstrap
        → profile/assets/optional links → publish → /manage
```

The bootstrap function is authenticated and transactional. It uses `auth.uid()`, not a browser-supplied user ID, and is guarded by a unique self-service creator index. It is retry-safe for the same first restaurant and rejects a second self-created workspace. New workspaces receive Free through the existing database default/trigger, so signup never calls Paddle. Workspace membership remains the authorization source; `admin_profiles` receives only the compatibility row needed by the inherited management surface.

Onboarding is intentionally short and mobile-first. It stores drafts in the existing restaurant profile, uses the existing tenant-safe `restaurant-assets` bucket for at most one logo and one primary image, and publishes the same row consumed by the public card and `/r/[slug]`. `getAccountState()` centrally routes new/incomplete users to `/onboarding` and completed/inherited users to `/manage`. Local auth emails are captured by Supabase Mailpit at `http://127.0.0.1:54524`; production requires Supabase SMTP, Site URL/redirect configuration, auth rate limits, and a launch decision on CAPTCHA.

## 15. Marketing and public pricing

The platform root renders the Reservevia marketing site only for the platform/local/preview host classes. Tenant hosts continue to use the existing public restaurant resolver, and `app.reservevia.com` continues to use account-state routing. The former global listing remains at `/restaurants` for compatibility/examples.

`/pricing` loads active public-safe rows from `public.plans`. `lib/marketing/plan-catalog.ts` contains only presentation copy and formatters; it does not duplicate numeric prices or limits. Anonymous plan CTAs route to app signup, not Paddle Checkout. The homepage, pricing, FAQ, product showcase, domain explanation, PWA explanation, sitemap, robots, and Reservevia-oriented privacy/terms route are documented in [MARKETING.md](MARKETING.md).

The marketing layer intentionally adds no analytics provider, tracking pixel, cookie banner, Paddle.js, management service worker, or tenant data query. Legal pages are baseline drafts requiring professional review before launch.

## Explicit phase boundary

Phase 9 stops after the platform marketing/pricing front door, source-of-truth plan presentation, host-safe SEO routes, and conversion paths into signup. Ownership transfer, multiple owners, custom permission builders, enterprise directory features, live Vercel project setup, nameserver changes, wildcard activation, live Paddle, annual pricing, trials, coupons, Enterprise, add-ons, analytics/tracking, guest push, native apps, custom-domain management PWA, and CMS work remain later phases.
