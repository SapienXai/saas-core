# Testing

The repository validates pure domain logic with Vitest: normalization,
entitlement precedence, grace expiry, invitation hashing/replay, seats, usage
limits, configuration validation and domain creation. The Core Lab executes
real operations against deterministic in-memory services and reports their
actual result. The opt-in database suite creates authenticated local users and
checks tenant isolation, RPC-only membership writes and concurrent usage.

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
`pack` job. The browser job uses a fresh local Supabase instance to verify the
signup page, protected-route redirect, safe `next` value and invalid-login
response in Chromium.

Provider credentials are not required for local tests. Use signed fixtures and
mock adapters for Paddle, Resend, Web Push and DNS/Vercel.
