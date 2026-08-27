# Testing

The repository validates pure domain logic with Vitest: normalization,
entitlement precedence, grace expiry, invitation hashing/replay, seats, usage
limits, configuration validation and domain creation. The Core Lab executes
real operations against deterministic in-memory services and reports their
actual result. The opt-in database suite creates authenticated local users and
checks tenant isolation, canonical platform role capabilities, audited
operator mutations, invitation/seat races and concurrent usage (23 checks).

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack:all
```

Run the authenticated database suite against a fresh local database:

```bash
supabase start
supabase db reset
eval "$(supabase status -o env)"
SAAS_CORE_DB_INTEGRATION=1 SUPABASE_URL="$API_URL" \
  SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  pnpm test -- tests/database.integration.test.ts
```

The suite is skipped unless `SAAS_CORE_DB_INTEGRATION=1` is set; the default
unit run therefore does not claim a database integration result.

The generated-app acceptance path is exercised with packed artifacts by the CI
`pack` job. Generated manifests remain versioned and portable; the Core
release harness uses a disposable scoped local registry to resolve unpublished
artifacts. It then copies the generated app to another temporary path and
performs a frozen reinstall before build verification. The browser journey
uses a fresh local Supabase instance to verify
signup, session/protected routes, two-workspace switching, invitation
wrong-account/replay protection, recovery request, safe redirects and mobile
overflow in Chromium. `pnpm release:verify` runs the complete local matrix,
including the generated app's production build and browser journey.

Provider credentials are not required for local tests. Use signed fixtures and
mock adapters for Paddle, Resend, Web Push and DNS/Vercel.
