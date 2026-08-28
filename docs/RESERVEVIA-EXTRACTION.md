# ReserveVia extraction inventory

Status: Final extraction record for SaaS Core 2.0. This file records the
source-preserving ReserveVia baseline, surgical product removal, and the
resulting ownership boundaries.

## Source boundary

- Canonical checkout: `/Users/kazimakgul/Documents/GitHub/reservevia`
- Canonical commit inspected: `e12566a6792c7144f576459e17b9ddce94de9e55`
- SaaS Core safety ref: `archive/pre-reservevia-rebuild` at `c5a1804aa0894d8fc1c7f35c75611d684081ec06`
- Import rule: readable source/configuration was copied into this checkout. `.git`, `node_modules`, `.next`, `.next-e2e`, `output`, `.env.local`, `.pnpm-store`, `tsconfig.tsbuildinfo`, and `supabase/.temp` were excluded.
- The ReserveVia checkout was not edited. The source checkout was clean when inspected.

The baseline was captured before domain removal. The current Core template has
no product-domain route or business module; empty directory names from the
source layout are not shipped as files.

## Classification legend

- **CORE** — preserve the implementation and behavior; only product naming, data, and configuration may change.
- **PRODUCT** — remove from Core. It belongs to restaurants, reservations, public restaurant discovery, Felix, or ReserveVia marketing.
- **MIXED** — copy the source file and remove only product branches/imports. Preserve the generic implementation around it.
- **INFRASTRUCTURE** — preserve or evaluate as a Core service boundary; delivery/runtime code must not be discarded because its current caller is product-specific.
- **DEVELOPMENT / TEST** — preserve when it tests generic behavior; retain product fixtures only in a clearly isolated reference fixture.
- **UNKNOWN** — keep until a dependency trace explains its ownership.

## Source-area inventory

| ReserveVia source path | Classification | SaaS Core destination | Preserve | Remove / change | Behavioral difference |
| --- | --- | --- | --- | --- | --- |
| `app/auth/**`, `components/auth/**`, `lib/auth-utils.ts`, `lib/supabase/**`, `proxy.ts` | CORE / MIXED | `app/auth/**`, `app/login`, `app/signup`, `lib/auth/**`, `lib/supabase/**` | Supabase SSR cookies, callback/confirm/redirect safety, login/signup/recovery forms, pending/error states | ReserveVia branding and marketing media | Auth redirects to generic `/app` and onboarding routes. |
| `app/onboarding/**`, `components/onboarding/**`, `app/invite/**`, `components/invitations/**`, `lib/invitations.ts`, `lib/invitation-email.ts` | CORE / MIXED | same route families and `lib/workspace/**` | Workspace creation, invitation acceptance, token handling, membership setup, wizard shell | Restaurant setup fields and restaurant assignment UI | Onboarding creates a Workspace without a restaurant/location prerequisite. |
| `context/manage-context.tsx`, `lib/management-context.ts`, `lib/management-layout-data.ts`, `app/manage/layout.tsx`, `app/manage/manage-layout-client.tsx` | MIXED | `context/workspace-context.tsx`, `app/app/**`, `lib/workspace/**` | Server-derived identity, selected workspace persistence, multi-workspace switching, layout loading | Restaurant selection, restaurant counts, reservation notices | The selected boundary is always `Workspace`; product domains are injected later. |
| `components/manage/manage-shell.tsx`, `manage-sidebar.tsx`, `manage-header.tsx`, `workspace-switcher.tsx`, `billing-overlay-portal.tsx` | CORE / MIXED | `components/app/**` | Full-height shell, fixed/collapsed sidebar, mobile drawer, header, theme portal, tooltips, active/pending states, safe areas | Reservation navigation, restaurant upgrade copy, product badges | Navigation comes from the optional product shell contract; the default Core nav remains the translated Workspace entry plus team/plan/setup/settings. |
| `components/ui/**` (Radix/shadcn-style primitives) | CORE | `components/ui/**` | Actual source implementations, variants, keyboard/focus behavior, overlays, animations, Sonner/toast, tables, responsive primitives | Product labels only where embedded | No intentional interaction simplification. |
| `components/theme-provider.tsx`, `app/layout.tsx`, `styles/globals.css`, `styles/reservevia-lilac.css`, `styles/consumer-states.css` | CORE / MIXED | `components/theme-provider.tsx`, `app/layout.tsx`, `styles/**` | Theme persistence, dark/light tokens, portal synchronization, typography, responsive states | ReserveVia logo/color/marketing selectors | Product identity is supplied by `ProductConfig`; Core tokens and geometry remain source-derived. |
| `lib/entitlements.ts`, `lib/billing/**`, `components/manage/paddle-billing-actions.tsx`, `app/manage/plan/**` | CORE / MIXED | `lib/billing/**`, `app/app/plan/**`, `packages/billing/**` | Plans, subscriptions, provider webhook inbox, lifecycle reconciliation, grace/past-due handling, server authorization | Reservation quotas, restaurant pricing/features/copy | Limits are generic entitlements/usage keys and never assume a restaurant metric. |
| `lib/email-delivery.ts`, `lib/email-service.ts`, `lib/email-template.ts`, `lib/invitation-email.ts`, email routes and delivery webhook | INFRASTRUCTURE / CORE | `lib/email/**`, `app/api/internal/cron/email-outbox/**` | Outbox, retries, delivery status, provider abstraction, webhook idempotency, invitation/account messages | Reservation/guest email templates and triggers | Product code registers its own message types. |
| `context/manage-push-notifications-context.tsx`, `lib/push-service.ts`, push routes, `components/notification-system.tsx` | INFRASTRUCTURE / CORE | `context/notifications/**`, `lib/notifications/**`, `app/api/push-notifications/**` | Web Push subscription and delivery plumbing, permission/status UI, generic notification surface | Reservation notification types and copy | Product notifications are typed extensions, not Core rows or branches. |
| `context/manage-pwa-install-context.tsx`, `lib/pwa.ts`, `lib/pwa-install.ts`, `lib/manage-offline-cache.ts`, `public/sw.js`, `app/manage/pwa/**` | CORE / MIXED | `lib/pwa/**`, `public/sw.js`, `app/app/pwa/**` | Install prompt, standalone behavior, safe-area/mobile shell, push integration, management cache mechanics | Reservation offline records and product-specific cache keys | Core caches shell/config only; products own domain offline data and sync. |
| `lib/domains/**`, `app/manage/domains/**`, `app/platform/domains/**`, `scripts/domains-reconcile.mjs` | CORE / MIXED | `lib/domains/**`, `app/app/domains/**`, `app/platform/domains/**` | Hostname normalization, verification/reconciliation, provider adapter boundary, status UI | `restaurant_domains` naming and restaurant public resolver | Domains point to a product workspace/public surface, not a restaurant entity. |
| `lib/platform-authorization.ts`, `lib/platform-audit.ts`, `lib/platform-admin.ts`, `lib/platform-operations.ts`, `lib/platform-alerts.ts`, `lib/platform-lifecycle.ts`, `lib/platform-types.ts`, `components/platform/**`, `app/platform/**` | CORE / MIXED | `lib/platform/**`, `components/platform/**`, `app/platform/**` | Platform-vs-workspace authorization, operators, filters, search, tables, responsive shell, health/audit/attention flows | Restaurant imports, claims, restaurant detail columns/actions, DataEngine | Platform pages operate on workspaces/users/billing/domains/health/audit/overrides. |
| `app/setup/**`, `components/setup/**`, setup/readiness helpers | CORE / MIXED | `app/app/setup/**`, `components/setup/**` | Readiness checks, setup status, feedback, server actions, loading states | Restaurant seed/profile prerequisites | Setup checks generic Core readiness and product-provided readiness hooks. |
| `lib/authorization.ts`, `lib/account-state.ts`, `lib/request-url.ts`, `lib/utils.ts`, `lib/asset-version.ts`, `hooks/**` | CORE | `lib/**`, `hooks/**` | Server-side authorization helpers, safe redirect URL handling, common utilities, pagination/mobile hooks | Product-specific helper branches | Authorization remains server-side and workspace scoped. |
| `app/page.tsx`, `components/marketing/**`, `styles/marketing*.css`, `app/pricing/**`, `app/privacy/**`, `app/terms/**` | PRODUCT / MIXED | Auth/public infrastructure only | Reusable auth/public layout pieces where independently generic | ReserveVia marketing site, restaurant copy, pricing copy, public product showcase | Core has no ReserveVia marketing site; the configured product owns marketing. |
| `app/restaurants/**`, `app/reserve/**`, `app/reservation/**`, `app/brand/**`, `app/r/**`, `app/claim/**`, public restaurant APIs and OG routes | PRODUCT | none | No restaurant business route | Entire route family and restaurant public SEO/booking behavior | These routes must not exist in Core. |
| `components/restaurant-*.tsx`, `components/reservation/**`, `components/public-brand-*.tsx`, `components/restaurant-form.tsx`, restaurant discovery/map/grid/card components | PRODUCT | none or product example fixture | None in generic runtime; source remains available through the canonical checkout | Restaurant profile, availability, booking, seating, guests, maps, claims | Future products add their domain components without changing Core. |
| `lib/restaurant-*.ts`, `lib/reservation-*.ts`, `lib/claimable-restaurants.ts`, `lib/website-import.ts`, `lib/dataengine-reservevia.ts`, `lib/platform-restaurant-import.ts`, `lib/ai/**` reservation services | PRODUCT | none | No domain behavior | Entire restaurant/reservation/DataEngine/AI domain set | Explicitly absent from Core runtime. |
| `test/**`, `e2e/**`, `tests/**` | DEVELOPMENT / TEST / MIXED | `tests/core/**`, `tests/reference/**` | Generic auth, workspace, billing, domain, platform, UI, PWA, security tests | Restaurant/reservation tests or isolate them as historical reference fixtures | New tests assert generic workspace behavior and forbidden-domain scans. |
| `scripts/run-local-auth-e2e.mjs`, local Supabase/test runners, build config | DEVELOPMENT / INFRASTRUCTURE | `scripts/**`, `tests/**` | Reusable local verification and test orchestration | DataEngine/restaurant seed scripts | Commands target the Core schema and generic routes. |

## Route disposition

The extracted baseline keeps the proven management composition but moves the generic product surface to `/app`:

| Baseline route family | Core result |
| --- | --- |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/**` | Preserve from source with generic product config. |
| `/onboarding/**`, `/invite/**` | Preserve; workspace-only creation and invitation membership. |
| `/manage/**` | Source-derived implementation is moved/aliased to `/app/**`; no restaurant pages survive. |
| `/platform/**` | Preserve operator shell and generic pages for workspaces, users, billing, domains, health, attention, audit, overrides. |
| `/restaurants/**`, `/reserve/**`, `/reservation/**`, `/brand/**`, `/claim/**`, `/r/**` | Remove. |
| `/`, `/pricing`, public docs, ReserveVia SEO/marketing | Remove from Core or leave only a generic/auth entry surface backed by `ProductConfig`. |

## Database inventory

### Preserve in the clean Core baseline

The following source migrations are the source evidence for the clean generic schema, but are not copied mechanically into the new migration stream:

- Workspace boundary and membership: `202608090001_workspace_schema.sql`, `202608090003_workspace_rls.sql`, and the self-service onboarding additions.
- Plans, subscriptions, usage periods, provider prices, webhook inbox, checkout sessions, billing mutations, cancellation feedback, and lifecycle projections: `20260809155804_plans_subscriptions_and_usage.sql`, `20260809165536_paddle_billing_foundation.sql`, `20260817090000_billing_lifecycle_projection.sql`, `20260818100000_subscription_lifecycle_and_calendar_quota.sql`.
- Workspace invitations: the generic part of `20260809202646_team_multi_restaurant.sql`.
- Workspace PWA and push subscriptions: `20260809214318_pwa_push_foundation.sql` plus the generic push policy hardening.
- Platform members, user controls, audit logs, settings, overrides, and user directory: `20260810214013_platform_admin_foundation.sql`, `20260812220000_platform_user_directory.sql`, and cleanup.
- Generic custom domains: the normalized/reconciled portions of `20260809190337_custom_restaurant_domains.sql` and subsequent domain indexes.
- Email delivery, provider webhook idempotency, delivery attempts, and outbox health: `20260822101703_dataengine_reservevia_import.sql`, `20260822114730_dataengine_reservevia_hardening.sql`, `20260822130000_dataengine_outbox_observability.sql`, `20260823051610_dataengine_outbox_trigger_type.sql`, and `20260823093000_resend_delivery_lifecycle.sql`, with all DataEngine/restaurant columns removed.

The clean stream starts at `20260827204359_saas_core_v2_baseline.sql`. It must contain only generic tables, functions, triggers, indexes, and RLS; no migration depends on `restaurants`, `reservations`, seating, restaurant enums, restaurant storage, or product-specific cron jobs.

### Remove

The legacy Felix baseline, `restaurants` and all restaurant media/profile tables, reservation tables/holds/tokens, seating/areas, restaurant domains, restaurant assignments, claims/imports/discovery, DataEngine lead tables, reservation AI tables, restaurant public RLS, restaurant storage assumptions, reservation quota functions, and product-specific triggers/jobs are product-owned and excluded from the clean baseline.

### Mixed and security rules

- Every product-owned table must attach through an intentional `workspace_id` boundary (or an explicit product-owned child of a workspace-owned record).
- RLS remains defense in depth: server authorization derives the authenticated identity, workspace membership is checked, and platform roles are separate from workspace roles.
- Provider/webhook and service-role operations remain server-only. No service-role key may appear in a client module or `NEXT_PUBLIC_*` environment variable.

## Source-preservation report

The Phase A baseline was a direct source copy. The current extraction has now
completed the first surgical pass. The measured report below distinguishes
domain removal from source-preserving UI moves; the target remains a small
semantic diff for reusable files: remove domain imports/branches and
substitute typed workspace/product inputs, without rewriting UI primitives or
interaction behavior.

Major fidelity anchors:

- `components/ui/**`: all 60+ Radix-backed primitives retained as the interaction foundation.
- `components/manage/manage-shell.tsx`, `manage-sidebar.tsx`, `manage-header.tsx`, `workspace-switcher.tsx`: shell geometry, persistence, collapse, mobile drawer, tooltips, theme, loading, and active states retained.
- `components/auth/reservevia-auth-shell.tsx` and auth forms: source auth flow and pending/error feedback retained, with product identity injected.
- onboarding/team/plan/setup/settings/platform compositions: source layout and interaction retained while product data is replaced with generic workspace view models.

### Measured source-preservation report

Counts are byte/line counts from the canonical checkout at
`e12566a6792c7144f576459e17b9ddce94de9e55` and the current Core checkout.
They are a review aid, not a claim that every line is semantically generic.

| ReserveVia source | SaaS Core result | Approx. preservation and reason for difference |
| --- | --- | --- |
| `components/manage/manage-shell.tsx` (10,690 bytes / 249 lines) | `components/manage/manage-shell.tsx` (10,258 / 244) | High preservation. Kept scroll ownership, pull-to-refresh, PWA/install slot, theme portal, collapsed/mobile shell, safe areas, loading and offline states. Removed restaurant usage and plan-notice slots. |
| `components/manage/manage-sidebar.tsx` (29,392 / 443) | `components/manage/manage-sidebar.tsx` (28,769 / 440) | High preservation. Kept Radix Tooltip/Dropdown/Sheet, expanded and icon-rail states, persistence, account menu, language, theme, push, usage bars, upgrade affordance, keyboard/focus behavior, and mobile scrolling. Removed restaurant, reservation, reports, seating, and restaurant-specific plan metrics. |
| `components/manage/manage-header.tsx` (52,966 / 1,168) | `components/manage/manage-header.tsx` (6,490 / 44) | Intentional large reduction. The source file is dominated by the reservation realtime subscription, restaurant lookup, reservation event payloads, and reservation popup lifecycle. Core keeps header geometry, workspace/page title, online state, notifications empty state, push hook, account/sign-out action, pending overlay, and navigation behavior. |
| `components/auth/reservevia-auth-shell.tsx` (7,031 / 131) | `components/auth/auth-shell.tsx` (5,140 / 10) | Split layout and responsive auth presentation preserved; product-specific asset/copy and source formatting were removed. Auth form behavior remains in the copied form components. |
| `components/ui/button.tsx` (2,395 / 70) | `components/ui/button.tsx` (2,395 / 70) | Source-identical Radix/CVA button implementation. |
| `components/ui/dialog.tsx` (3,616 / 122) | `components/ui/dialog.tsx` (3,616 / 122) | Source-identical dialog, focus trap, Escape/outside dismissal, and portal behavior. |
| `components/ui/sheet.tsx` (3,863 / 135) | `components/ui/sheet.tsx` (3,863 / 135) | Source-identical mobile drawer/sheet behavior and animations. |
| `styles/reservevia-lilac.css` (22,006 / 741) | `styles/core-lilac.css` (19,327 / 659) | Palette and management interaction selectors preserved; removed selectors tied to restaurant pages, seating, public booking and ReserveVia assets. |
| `app/globals.css` (169,229 / 7,168) | `app/globals.css` (5,250 / 192) | Intentional scope reduction. The source file combines marketing, public restaurant, booking, map, seating, and management CSS. Core keeps application shell geometry, scroll/document locking, portal theme behavior, safe-area/mobile rules, reduced motion, focus, and feedback styles. |

The `manage-header.tsx` and global CSS reductions are the two deliberate large
diffs. They are not replacements for the shell: their removed majority is
traceable to product realtime/domain surfaces. The sidebar, shell, overlays,
and primitives remain close to the production source because they are the
platform’s interaction language.

## Final extraction and recomposition note

The generic catalog, keyed usage model, and workspace limit enforcement are
now product-neutral. A future ReserveVia consumer can add its removed
restaurant/reservation tables and RLS under `workspace_id`, register its own
plan/metric catalog, and compose product navigation/pages without changing
Core auth, membership, billing lifecycle, PWA, Platform Control, or UI
primitives. The source ReserveVia repository remains read-only and untouched.

## Extraction proof obligations

1. Run baseline typecheck, tests, and webpack build against this imported source.
2. Remove product routes and domain modules progressively; typecheck, test, and build after each boundary.
3. Add the clean v2 Core schema and RLS tests from zero; scan the reset schema for forbidden terms.
4. Verify `/app`, auth/onboarding, team, plan, setup, settings, PWA, platform, light/dark, desktop/mobile, dialogs, menus, toasts, and sidebar interactions.
5. Prove a temporary Projects product uses only the workspace boundary and does not require restaurant concepts.
6. Document how ReserveVia could recompose its removed domain on top of Core without changing Core internals.
