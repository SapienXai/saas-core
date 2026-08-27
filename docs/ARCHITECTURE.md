# Architecture

SaaS Core is a modular monolith delivered as versioned packages. The core
boundary ends at `Workspace`; products own their entities, routes, screens and
industry-specific policies.

```text
Auth session → Workspace → Membership → Permission
                         → Plan → Entitlement → Usage
                         → Provider adapters → Platform Control / Audit
                         → Product domain
```

The domain package is framework-neutral. A server adapter supplies Supabase
session resolution, persistence, transactions, logging and provider secrets.
The in-memory store is a reference implementation for deterministic tests, not
a production persistence layer.

Generated products consume versioned Core packages through their normal package
registry contract. Unpublished local artifacts are resolved only by the Core
acceptance harness, outside the generated product dependency contract.

Core uses extension points for product features, metrics, lifecycle stages and
resource/scope access adapters. It does not create universal resources or
rename product entities into generic abstractions.

## UI ownership and runtime boundary

The 1.2 UI architecture keeps secure data loading and visual composition as
separate layers:

```text
Core runtime / repository
        ↓ authenticated server loader or action
typed product or Core view model + typed action contract
        ↓
default Core UI view  OR  product-owned route/composition
        ↓
published Core CSS tokens → product-owned product.css overrides
```

`@sapienx/saas-core-ui` is provider- and database-blind. It does not import
Supabase, Paddle, Resend, Vercel, repositories or service-role clients. Default
views receive values such as `TeamViewModel`, `PlanViewModel` and
`SetupCheckViewModel`; a product can replace the view while retaining the same
server contract.

The package is split into explicit boundaries:

| Module | Runtime boundary | Responsibility |
| --- | --- | --- |
| `@sapienx/saas-core-ui/primitives` | Server-compatible | Semantic controls and layout primitives. |
| `@sapienx/saas-core-ui/feedback` | Server-compatible | Status, loading, empty, usage and plan presentation. |
| `@sapienx/saas-core-ui/views` | Server-compatible | Typed default composed views and view models. |
| `@sapienx/saas-core-ui/shell` | Server-compatible plus mobile client island | App/Auth shell, navigation and workspace presentation. |
| `@sapienx/saas-core-ui/theme` | Client | Theme preference, system mode and token application. |
| `@sapienx/saas-core-ui/styles.css` | CSS asset | Published semantic tokens and responsive component styles. |

The generated root layout imports the published CSS, then
`src/styles/product.css`, and wraps the app in `ThemeProvider`. The product CSS
file is intentionally outside Core's managed ownership so a product can make
deep visual changes without generating Core drift. Product navigation is
similarly composed from `src/product/navigation.ts` and passed into
`AppShell`.

The old `components.tsx` entry remains as a deprecated compatibility facade for
the 1.1.x exports (`AppShell`, `WorkspaceSwitcher`, `StatusBadge`, `PlanCard`,
`UsageMeter`, `BillingStatus`, `EmptyState`, `LoadingState` and `ErrorState`).
New consumers can use the root or explicit subpath exports for better tree
shaking and clearer client boundaries.

The complete ReserveVia review and exclusion rationale is recorded in
[UI parity](UI-PARITY.md).
