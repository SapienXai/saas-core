# Reservevia Marketing Website

Phase 9 moves the platform root from the inherited restaurant listing to the Reservevia commercial front door.

## Positioning

Primary message: **Your restaurant. Online in minutes.**

Reservevia is positioned for independent restaurants, small restaurant groups, and small-to-medium hospitality operators. The customer-facing story is a beautiful booking page, online reservations, reservation management, team access, hosted URLs, optional custom domains, and a branded management app on eligible plans. The homepage also introduces Reservevia's AI-native infrastructure: public restaurant data, an agent REST API, Remote MCP, and OpenAI reservation surfaces backed by the same booking engine.

The site avoids internal architecture language, unsupported claims, invented testimonials, customer logos, usage metrics, ratings, and awards.

## Routes and host boundary

```text
reservevia.com/        marketing homepage
reservevia.com/pricing public pricing
reservevia.com/restaurants compatibility/example listing
reservevia.com/privacy baseline privacy route
reservevia.com/terms   baseline terms route
reservevia.com/docs   public developer documentation
reservevia.com/docs/agents agent integration guide
app.reservevia.com     authentication and management
slug.reservevia.com   restaurant booking page
custom domain          restaurant booking page
```

`lib/marketing/host.ts` prevents marketing pages from rendering on app or restaurant hosts. The root `app/page.tsx` first uses the existing hostname resolver; hosted/custom requests continue to render `RestaurantLandingPage` and platform-root requests render `MarketingHome`.

The former public directory is preserved at `/restaurants` for compatibility/examples. It is no longer the platform homepage.

## Pricing source of truth

`public.plans` remains the only source for public numeric commercial values:

- monthly price
- restaurant limit
- user limit
- reservation limit
- history days
- feature flags
- display order

`lib/marketing/plan-catalog.ts` contains only typed presentation metadata and formatting. `lib/marketing/public-plans.ts` loads active rows server-side. Unlimited database `NULL` values render as `Unlimited`; history values render as customer-friendly labels such as `30 days`, `1 year`, and `Unlimited`.

Anonymous paid-plan CTAs go to the canonical signup origin. They do not start Paddle Checkout. The intended path is signup → onboarding → `/manage/plan` → authenticated billing.

## Product visuals and copy

Marketing visuals use Reservevia product concepts: a public restaurant page, reservation management, hosted URL, team access, and multi-restaurant switching. The showcase is a product illustration, not a customer claim or a fake screenshot with private data.

The homepage narrative is:

1. Create your restaurant.
2. Publish your page.
3. Start taking reservations.

The AI-native narrative follows the same product truth:

1. Discover a published restaurant through structured public data.
2. Refresh live availability through the shared reservation engine.
3. Hold, confirm, and manage reservations through REST, MCP, or OpenAI surfaces.

The homepage links to `/docs` and `/docs/agents`; public technical details remain in the documentation surface rather than being mixed into the primary conversion copy.

Free is presented as a real product: one restaurant, one user, 100 reservations per period/month, hosted page, basic analytics, reservation push alerts, and 30-day history. Starter, Pro, and Business describe only capabilities present in the plan catalog and current application.

## SEO and performance

The platform homepage and pricing route have Reservevia-specific metadata and canonical URLs. `app/sitemap.ts` contains stable platform routes. `app/robots.ts` allows public marketing/restaurant routes and disallows management, authentication, reset, and API paths.

Marketing is server-rendered and does not load Paddle.js, management data, Web Push, or the management service worker. The service worker remains registered only on the management origin. Host-sensitive rendering remains dynamic so platform marketing cannot be cached across tenant hosts.

## Legal status

`/privacy` and `/terms` now contain Reservevia-oriented baseline drafts rather than inherited Felix customer-policy copy. Professional legal review is required before production launch. No regulatory certification, SLA, or compliance guarantee is claimed.

No analytics vendor, tracking pixel, cookie banner, or conversion provider was added. CTA and pricing accuracy are covered by local tests without a third-party analytics dependency.

## Validation checklist

- Confirm `/` renders marketing only on the platform root/local platform host.
- Confirm `www` redirects through the existing middleware.
- Confirm app root still enters account-state routing.
- Confirm hosted/custom tenant pages remain restaurant-specific.
- Confirm pricing rows match the active local `plans` catalog.
- Inspect 375px, 390px, 430px, tablet, desktop, and large desktop layouts.
- Review privacy and terms with counsel before launch.
- Keep production DNS, SMTP, Paddle Live, analytics, and tracking outside this phase.
