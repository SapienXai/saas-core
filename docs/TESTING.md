# Testing

The repository validates pure domain logic with Vitest: normalization,
entitlement precedence, grace expiry, invitation hashing/replay, seats, usage
limits, configuration validation and domain creation. The SQL migration is
structured for local Supabase RLS/integration tests; target projects should add
authenticated cross-tenant tests before production.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack:all
```

Provider credentials are not required for local tests. Use signed fixtures and
mock adapters for Paddle, Resend, Web Push and DNS/Vercel.
