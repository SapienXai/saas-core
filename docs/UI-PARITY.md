# ReserveVia UI parity and extraction matrix

SaaS Core 1.2.0 uses ReserveVia as a reference for interaction quality,
responsive composition and accessibility. It does not import ReserveVia
identity, business terminology, data contracts or product routes.

For implementation-level API, behavior, accessibility, visual and status
evidence, see the authoritative [UI fidelity scorecard](UI-FIDELITY.md).

The source inventory was reviewed in ReserveVia's `components/ui/` and
composed component directories. The shared package is provider- and
database-blind; its defaults receive typed view models and actions from the
consuming product.

## Primitive inventory

| ReserveVia source | Decision | SaaS Core 1.2 boundary and rationale |
| --- | --- | --- |
| `accordion.tsx` | MIGRATE / GENERALIZE | Radix Accordion provides real disclosure state, keyboard navigation, focus and content relationships. |
| `alert-dialog.tsx` | REIMPLEMENT / GENERALIZE | Shares the generic dialog surface; destructive confirmation semantics remain product-composed. |
| `alert.tsx` | MIGRATE | `Alert` and semantic tone tokens are generic and useful for setup, auth and product workflows. |
| `aspect-ratio.tsx` | REIMPLEMENT / GENERALIZE | Layout utility is exported without media or product assumptions. |
| `avatar.tsx` | MIGRATE | `Avatar`, image and fallback slots are generic account/team presentation. |
| `badge.tsx` | MIGRATE | `Badge` and Core status tones cover operational, entitlement and product labels. |
| `breadcrumb.tsx` | REIMPLEMENT / GENERALIZE | Navigation hierarchy is product-owned data rendered by a neutral semantic nav. |
| `button.tsx` | MIGRATE | Variants, loading state, focus state and touch-sized controls are package-owned. |
| `calendar.tsx` | MIGRATE / GENERALIZE | `react-day-picker` provides the real month/day interaction without ReserveVia booking rules or locale assumptions. |
| `card.tsx` | MIGRATE | Card slots are the base for default views and custom product compositions. |
| `carousel.tsx` | MIGRATE / GENERALIZE | Embla provides real controls, keyboard handling and slide state; product teams choose media and autoplay policy. |
| `chart.tsx` | REIMPLEMENT / GENERALIZE | A styled chart container avoids shipping a charting vendor or product metrics model. |
| `checkbox.tsx` | MIGRATE | Radix Checkbox preserves form compatibility while providing controlled and indeterminate-ready state. |
| `collapsible.tsx` | MIGRATE / GENERALIZE | Radix Collapsible provides controlled disclosure state and keyboard semantics. |
| `command.tsx` | MIGRATE / GENERALIZE | cmdk provides the keyboard-searchable command surface; filtering data remains product-owned. |
| `confirmation-dialog.tsx` | USE EXISTING EQUIVALENT | Compose `AlertDialog` with typed product copy and server action. |
| `context-menu.tsx` | MIGRATE / GENERALIZE | Radix ContextMenu provides real right-click and keyboard menu behavior. |
| `dialog.tsx` | MIGRATE | Radix Dialog provides a portal, focus trap, Escape dismissal and restore-focus contract. |
| `drawer.tsx` | MIGRATE | Vaul provides a real drawer primitive; mobile shell uses the dedicated Core client island. |
| `dropdown-menu.tsx` | MIGRATE / GENERALIZE | Radix DropdownMenu provides real roving focus, submenu and item state behavior. |
| `form.tsx` | MIGRATE | Form slots and native form controls preserve server-action compatibility. |
| `hover-card.tsx` | MIGRATE / GENERALIZE | Radix HoverCard provides delayed hover/focus behavior; essential information remains visible. |
| `input.tsx` | MIGRATE | Focus, error and token styling are package-owned. |
| `input-otp.tsx` | MIGRATE / GENERALIZE | `input-otp` provides segmented entry, caret and paste-aware keyboard behavior without provider-specific verification semantics. |
| `label.tsx` | MIGRATE | Labeling is foundational for auth and product forms. |
| `menubar.tsx` | REIMPLEMENT / GENERALIZE | Neutral role wrapper leaves product menu content and behavior extensible. |
| `navigation-menu.tsx` | REIMPLEMENT / GENERALIZE | Product-owned navigation can use the exported semantic nav boundary. |
| `pagination.tsx` | REIMPLEMENT / GENERALIZE | Pagination slots are generic; data fetching and URL state remain product-owned. |
| `popover.tsx` | MIGRATE / GENERALIZE | Radix Popover provides anchor, portal, outside-click and Escape behavior. |
| `progress.tsx` | MIGRATE | Accessible progress semantics support usage, readiness and product workflows. |
| `radio-group.tsx` | MIGRATE / GENERALIZE | Radix RadioGroup provides arrow-key navigation and radio state semantics. |
| `resizable.tsx` | MIGRATE / GENERALIZE | `react-resizable-panels` provides real draggable handles; persistence remains product-owned. |
| `scroll-area.tsx` | REIMPLEMENT / GENERALIZE | Overflow wrapper keeps narrow tables and product lists usable. |
| `select.tsx` | MIGRATE | Radix Select provides real keyboard/listbox behavior and portals; `NativeSelect` remains explicit for progressive-enhancement form-only cases. |
| `separator.tsx` | MIGRATE | Semantic visual separation is used by shell and composed views. |
| `sheet.tsx` | USE EXISTING EQUIVALENT | The mobile navigation drawer is the Core-specific sheet use case and remains isolated in `shell-client.tsx`. |
| `sidebar.tsx` | MIGRATE | `AppShell` owns the generic desktop sidebar; products provide navigation data. |
| `skeleton.tsx` | MIGRATE | Loading geometry is reusable and respects reduced motion. |
| `slider.tsx` | MIGRATE / GENERALIZE | Radix Slider provides real pointer and arrow-key adjustment with labelled value semantics. |
| `sonner.tsx` | REIMPLEMENT / GENERALIZE | `Toast`/`Toaster` provide a neutral live-region surface; products choose notification orchestration. |
| `switch.tsx` | MIGRATE / GENERALIZE | Radix Switch provides controlled state and switch semantics for client forms. |
| `table.tsx` | MIGRATE | Responsive overflow and semantic table slots are part of the default foundation. |
| `tabs.tsx` | MIGRATE / GENERALIZE | Radix Tabs provides roving focus and tab/list/panel relationships; URL persistence remains composable. |
| `textarea.tsx` | MIGRATE | Shared field styling and focus behavior are reusable. |
| `toast.tsx` / `toaster.tsx` | MIGRATE / GENERALIZE | Radix Toast and Sonner provide real queued live-region feedback with theme sync. |
| `toggle.tsx` / `toggle-group.tsx` | REIMPLEMENT / GENERALIZE | Pressed-state semantics are exposed without a global store. |
| `tooltip.tsx` | MIGRATE / GENERALIZE | Radix Tooltip provides delayed portal content for hover/focus; essential content is never tooltip-only. |
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
