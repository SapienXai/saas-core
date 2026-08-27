# ReserveVia UI parity and extraction matrix

SaaS Core 1.2.0 uses ReserveVia as a reference for interaction quality,
responsive composition and accessibility. It does not import ReserveVia
identity, business terminology, data contracts or product routes.

The source inventory was reviewed in ReserveVia's `components/ui/` and
composed component directories. The shared package is provider- and
database-blind; its defaults receive typed view models and actions from the
consuming product.

## Primitive inventory

| ReserveVia source | Decision | SaaS Core 1.2 boundary and rationale |
| --- | --- | --- |
| `accordion.tsx` | REIMPLEMENT / GENERALIZE | Native `details`/`summary` semantics provide a dependency-free disclosure primitive. |
| `alert-dialog.tsx` | REIMPLEMENT / GENERALIZE | Shares the generic dialog surface; destructive confirmation semantics remain product-composed. |
| `alert.tsx` | MIGRATE | `Alert` and semantic tone tokens are generic and useful for setup, auth and product workflows. |
| `aspect-ratio.tsx` | REIMPLEMENT / GENERALIZE | Layout utility is exported without media or product assumptions. |
| `avatar.tsx` | MIGRATE | `Avatar`, image and fallback slots are generic account/team presentation. |
| `badge.tsx` | MIGRATE | `Badge` and Core status tones cover operational, entitlement and product labels. |
| `breadcrumb.tsx` | REIMPLEMENT / GENERALIZE | Navigation hierarchy is product-owned data rendered by a neutral semantic nav. |
| `button.tsx` | MIGRATE | Variants, loading state, focus state and touch-sized controls are package-owned. |
| `calendar.tsx` | REIMPLEMENT / GENERALIZE | Date input is exposed without ReserveVia booking rules or locale assumptions. |
| `card.tsx` | MIGRATE | Card slots are the base for default views and custom product compositions. |
| `carousel.tsx` | REIMPLEMENT / GENERALIZE | A neutral region contract is exported; product teams choose media/gesture behavior. |
| `chart.tsx` | REIMPLEMENT / GENERALIZE | A styled chart container avoids shipping a charting vendor or product metrics model. |
| `checkbox.tsx` | MIGRATE | Native input preserves form and server-action compatibility. |
| `collapsible.tsx` | REIMPLEMENT / GENERALIZE | Native disclosure behavior keeps the server-rendered primitive small and accessible. |
| `command.tsx` | REIMPLEMENT / GENERALIZE | Search region is exported; filtering and async data remain product-owned. |
| `confirmation-dialog.tsx` | USE EXISTING EQUIVALENT | Compose `AlertDialog` with typed product copy and server action. |
| `context-menu.tsx` | REIMPLEMENT / GENERALIZE | Neutral wrapper is available without tying Core to a menu state machine. |
| `dialog.tsx` | MIGRATE | Generic modal surface and title/description slots are available from the package. |
| `drawer.tsx` | USE EXISTING EQUIVALENT | Mobile shell uses the dedicated Core client island; `Drawer` aliases the neutral dialog surface. |
| `dropdown-menu.tsx` | REIMPLEMENT / GENERALIZE | Details-based menu works in SSR and can be replaced by a product interaction layer. |
| `form.tsx` | MIGRATE | Form slots and native form controls preserve server-action compatibility. |
| `hover-card.tsx` | REIMPLEMENT / GENERALIZE | Disclosure wrapper is optional and does not gate essential information behind hover. |
| `input.tsx` | MIGRATE | Focus, error and token styling are package-owned. |
| `input-otp.tsx` | REIMPLEMENT / GENERALIZE | Numeric one-time-code input remains provider-neutral. |
| `label.tsx` | MIGRATE | Labeling is foundational for auth and product forms. |
| `menubar.tsx` | REIMPLEMENT / GENERALIZE | Neutral role wrapper leaves product menu content and behavior extensible. |
| `navigation-menu.tsx` | REIMPLEMENT / GENERALIZE | Product-owned navigation can use the exported semantic nav boundary. |
| `pagination.tsx` | REIMPLEMENT / GENERALIZE | Pagination slots are generic; data fetching and URL state remain product-owned. |
| `popover.tsx` | REIMPLEMENT / GENERALIZE | Disclosure-based popover is dependency-free and safe for non-essential contextual UI. |
| `progress.tsx` | MIGRATE | Accessible progress semantics support usage, readiness and product workflows. |
| `radio-group.tsx` | REIMPLEMENT / GENERALIZE | Native radio inputs preserve keyboard and form behavior. |
| `resizable.tsx` | REIMPLEMENT / GENERALIZE | Structural panel/handle slots are available without a layout persistence policy. |
| `scroll-area.tsx` | REIMPLEMENT / GENERALIZE | Overflow wrapper keeps narrow tables and product lists usable. |
| `select.tsx` | MIGRATE | Native select is reliable in generated SSR forms and mobile browsers. |
| `separator.tsx` | MIGRATE | Semantic visual separation is used by shell and composed views. |
| `sheet.tsx` | USE EXISTING EQUIVALENT | The mobile navigation drawer is the Core-specific sheet use case and remains isolated in `shell-client.tsx`. |
| `sidebar.tsx` | MIGRATE | `AppShell` owns the generic desktop sidebar; products provide navigation data. |
| `skeleton.tsx` | MIGRATE | Loading geometry is reusable and respects reduced motion. |
| `slider.tsx` | REIMPLEMENT / GENERALIZE | Native range input avoids a product-specific interaction dependency. |
| `sonner.tsx` | REIMPLEMENT / GENERALIZE | `Toast`/`Toaster` provide a neutral live-region surface; products choose notification orchestration. |
| `switch.tsx` | REIMPLEMENT / GENERALIZE | Native checkbox with switch semantics works with server and client forms. |
| `table.tsx` | MIGRATE | Responsive overflow and semantic table slots are part of the default foundation. |
| `tabs.tsx` | REIMPLEMENT / GENERALIZE | Tab roles and slots are exported; state and URL persistence remain composable. |
| `textarea.tsx` | MIGRATE | Shared field styling and focus behavior are reusable. |
| `toast.tsx` / `toaster.tsx` | REIMPLEMENT / GENERALIZE | Live-region primitives are provider-free and tree-shakeable. |
| `toggle.tsx` / `toggle-group.tsx` | REIMPLEMENT / GENERALIZE | Pressed-state semantics are exposed without a global store. |
| `tooltip.tsx` | REIMPLEMENT / GENERALIZE | The baseline uses native title plus an optional semantic content slot; essential content is never tooltip-only. |
| `orb-loader.tsx` / `page-loading.tsx` | USE EXISTING EQUIVALENT | `LoadingState`, `Skeleton` and the button spinner provide calmer, reduced-motion-safe loading feedback. |
| `pagination-controls.tsx` | USE EXISTING EQUIVALENT | Product pagination composes the neutral pagination slots with its own query contract. |

## Composed pattern inventory

| ReserveVia pattern/source | Decision | SaaS Core boundary and rationale |
| --- | --- | --- |
| `components/auth/` | MIGRATE / GENERALIZE | `AuthShell` and generated auth routes preserve security actions while product-owned copy/layout can be replaced. |
| `components/manage/` | MIGRATE / GENERALIZE | `AppShell`, grouped navigation, workspace switcher, account area and responsive content are neutralized. |
| `components/onboarding/` | MIGRATE / GENERALIZE | The default onboarding route is a product-owned composition over Core readiness contracts. |
| `components/platform/` | MIGRATE / GENERALIZE | `DefaultPlatformView` and generated Platform Control routes preserve the separate operator boundary. |
| `components/setup/` | MIGRATE / GENERALIZE | `DefaultSetupView` renders typed checks and never claims unverified providers are healthy. |
| invitation/team tables | MIGRATE / GENERALIZE | Team and invitation presentation use stable view models; membership authorization remains server-side. |
| responsive list/table composition | MIGRATE | `responsiveEntityPresentation` and package table styles preserve narrow-screen usability without a domain model. |
| marketing sections and brand storytelling | PRODUCT-SPECIFIC — EXCLUDE | ReserveVia campaigns, copy, media and conversion paths are product identity, not platform UI. |
| reservation, venue, map and restaurant screens | PRODUCT-SPECIFIC — EXCLUDE | These contain business entities and policies that must remain after the Workspace boundary. |
| claim/onboarding flows tied to restaurant ownership | PRODUCT-SPECIFIC — EXCLUDE | The shared onboarding boundary is generic; product ownership claims are not. |
| development-only diagnostics and fixture components | OBSOLETE — EXCLUDE | They are not a stable consumer-facing UI contract. |

## Extraction rules

- Package styles are delivered by the published `@sapienx/saas-core-ui/styles.css`
  export. A consuming app imports it before its product-owned CSS.
- `packages/ui/src/primitives.tsx`, `feedback.tsx`, `shell.tsx` and `views.tsx`
  contain no Supabase, Paddle, Resend, Vercel, repository or service-role
  imports.
- `ThemeProvider`, `ThemeToggle` and the mobile navigation drawer are explicit
  client islands. Primitives, feedback and default views remain server-render
  compatible wherever their API permits.
- Product routes, logo assets, navigation composition, theme JSON and deep CSS
  overrides are product-owned and are recorded as such in `.saas-core.json`.
