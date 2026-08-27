# Reservevia testing

Reservevia keeps executable automated tests in `test/` and browser tests in
`e2e/`. The existing `tests/ai/tool-selection-cases.json` file is a fixture
for AI evaluation tooling, not a second test runner, so it remains in place.

## Local layers

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:run
pnpm run db:test:clean
pnpm run auth:e2e
pnpm run e2e:critical
pnpm run build
```

`test:run` is the fast Vitest gate. `db:test:clean` resets the local Supabase
stack before running the RLS, self-service, team, claimable, and reservation
lifecycle integration suites. Both database scripts refuse non-local
Supabase URLs.

`auth:e2e` is the protocol-level Supabase Auth/Mailpit check. The real browser
suite is Playwright:

```bash
pnpm run e2e:install
pnpm run e2e:critical
pnpm run e2e:full
```

The local browser runner starts a separate Next build directory (`.next-e2e`),
injects only the local Supabase credentials, disables external Resend delivery,
and enables the scenario factory. Tests are serialized by default because the
local Supabase/Next development stack is shared; set
`RESERVEVIA_E2E_WORKERS` explicitly when the infrastructure is isolated enough
for parallel workers.

## Deterministic scenarios

The factory in `lib/dev/scenario-factory.ts` supports:

`free-new`, `free-99`, `free-100`, `starter-active`, `pro-active`,
`pro-past-due`, `business-multi`, `unclaimed`, and `staff-restricted`.

Each seed has a unique run ID and returns an exact manifest containing the
created users, workspaces, restaurants, reservations, and customer-management
tokens. Playwright fixtures destroy that manifest after every test. The
development-only panel is `/dev/scenarios`; its files use `.dev` compound
extensions and are excluded from production route discovery and bundling.
The factory also requires an explicit enable flag, local Supabase on port
`54521`, a service-role key, and Paddle Sandbox mode.

The critical browser suite also exercises duplicate submit idempotency,
reservation update/cancel through scoped customer links, Free reservation
quota blocking, restaurant-limit upgrade routing, workspace switching, role
scope, claim completion, email confirmation, and mobile overflow boundaries.

## CI gates

- **Quality:** lint, typecheck, Vitest, and production build.
- **Database:** local Supabase startup/reset, integration tests, and generated
  type validation.
- **E2E critical:** local Supabase, deterministic scenarios, the app, and the
  Chromium critical Playwright suite on pull requests.
- **E2E full:** the broader browser matrix on `main` and nightly, with
  Firefox/WebKit enabled.

Paddle checkout is intentionally not driven through a brittle browser payment
flow. Subscription state, webhook idempotency/order, entitlement transitions,
past-due grace, cancellation, and quota behavior are verified at unit and
Supabase integration levels. A provider-backed checkout test can be added in a
later phase without changing the current browser fixtures.
