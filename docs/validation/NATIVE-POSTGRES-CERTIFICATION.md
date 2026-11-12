# SaaS Core 2.9 native PostgreSQL verification

Verified on 2026-11-12. The candidate is package/runtime 2.9.0 and schema
compatibility 2.0. The tested runtime source is
`863c09f15307d1bf9c62bf1b4afad8ab613f4a35`. BookPlace installed local
tarballs and applied the managed update through the packaged CLI.

| Evidence | Environment | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile`, `pnpm verify` | Core checkout | PASS. Hygiene, lint, typecheck, 304 tests passed and 32 integration tests skipped by the unconfigured unit command. Source parity covered 316 managed files and 17 migrations. The consumer contract passed. |
| `SAAS_CORE_E2E=1 pnpm build` | Core checkout | PASS. Next.js optimized build and type checks completed. |
| `pnpm db:test:schema`, `pnpm core:scan`, `pnpm core:commercial-scan`, `pnpm core:ui-fidelity` | Core checkout | PASS. 17 mirrored migrations, 23 baseline tables plus 3 durable billing tables, domain surface, RLS and 52 UI primitives. |
| `node --env-file=.env.local scripts/test-native-postgres.mjs` with a pool size of one | Local PostgreSQL 17.11 | PASS. Two executable transaction and security cases. |
| `node --env-file=.env.local scripts/test-neon-runtime.mjs` | Local PostgreSQL 17.11, Next.js and Mailpit | PASS. Browser signup, verification, onboarding, denied access, reset and sign-out. Native JWKS returned 404. |
| `vitest run test/paddle-webhook.integration.test.ts` with the local Neon environment | Local PostgreSQL 17.11 | PASS. Two cases using mocked provider responses. New checkout uses Paddle, while Stripe renewals and cancellation follow the stored provider. |
| Legacy Neon smoke, using the unset transport default | Local PostgREST 16.5 and PostgreSQL 17.11 | PASS. Signed legacy RPC, structured OR and foreign key embedding. |
| Supabase integration suite with the local fixture addresses set to the isolated stack | Supabase API on loopback port 55961 | PARTIAL. 27 passed across eight files. The remaining file skipped all six cases after the Auth fixture creation timed out. A targeted retry hit the same endpoint timeout. A direct admin request returned HTTP 504 with no Core code in the call path. |
| Critical Supabase browser suite on the isolated stack | Chromium and local Supabase | BLOCKED. The Auth admin request timed out in the account fixture hook, before the browser assertions ran. |
| `pnpm core:pack`, `pnpm release:metadata`, `pnpm release:packages`, `pnpm core:lifecycle`, `pnpm release:artifact-lifecycle`, `pnpm release:recovery-proof`, `pnpm release:workflow-contract`, `pnpm release:environment` | Core checkout, local packages and simulated publication lifecycle | PASS. Five packages inspected. Lifecycle covered dry-run/apply agreement, conflict preservation, product migration history, backups and rollback. |
| `pnpm core:consumer-proof` | Core disposable Supabase consumer | BLOCKED. Generated consumer and static doctor completed. The disposable Supabase start failed in both the standard attempt and a retry with optional services excluded. |
| `pnpm release:check` | Core checkout | NOT_RUN as an aggregate. Its hard-coded local Supabase project already belonged to another checkout. Running its reset there would have overwritten that fixture. The separate checks are recorded here. |
| Packaged `saas-core update --dry-run --json`, update, `doctor` and `diff . --json` | BookPlace with local package artifacts | PASS. 25 planned updates, zero conflicts, 13 preserved product migrations, 316 healthy managed files. Doctor verified schema 2.0 via PostgreSQL and reported one optional provider warning. Source, version, package and schema drift were empty. |
| `pnpm install --frozen-lockfile`, `pnpm verify` | BookPlace with the final runtime tarball | PASS. Lint, typecheck, 14 tests, production build. |
| `pnpm bookplace:db:test` | Local PostgreSQL 17.11 | PASS. Two groups of SQL assertions. The test transaction rolled back. |
| `pnpm bookplace:e2e` | Local Next.js, PostgreSQL 17.11 and Mailpit | PASS. Three Chromium tests. The product scenario used mobile and desktop contexts. Synthetic signup through publication took 12 seconds and the manual reservation sample took 688 ms. |
| Native security fixture with a transaction-pool-aware connection check | Isolated Frankfurt Neon PostgreSQL 18.6 | PASS. Two security cases. The pool ran with one client connection and each transaction verified its active role and claims. Neon may assign different PostgreSQL backends to successive transactions. |
| BookPlace SQL fixture with test-role grants inside its rollback-only transaction | Isolated Frankfurt Neon PostgreSQL 18.6 | PASS. Two groups of product assertions. Test data and temporary grants rolled back. |
| BookPlace Playwright product scenario with hosted timeouts | Local Next.js and Mailpit, isolated Frankfurt Neon PostgreSQL 18.6 | PASS. One complete product scenario in 8.1 minutes, including the last-room race, PMS, guest booking and Studio publication. Synthetic signup through publication took 126 seconds and the manual reservation sample took 9,096 ms. |
| Vercel Preview → Neon branch | Vercel | NOT_RUN. Preview deployment and server environment binding require owner authorization. |
| CI and real npm publication | GitHub and npm | NOT_RUN. Local candidate artifacts only. Registry latest was 2.8.0 at verification. |

## Security and product observations

The local role sequence was authenticated A, authenticated B, anonymous,
service and authenticated A on one physical PostgreSQL backend. Every
request returned to the dedicated login with empty claims. A duplicate
write and an eight-second statement timeout both rolled back. Anonymous
guest access on Frankfurt returned `42501`. The data login and the three
application roles had no BYPASSRLS. Client values were bound. Invalid
identifiers, malformed identities, an unfiltered delete and a private
function request were rejected.

BookPlace exercised owner onboarding and the 10-room quota, public hotel
publication and booking, guest email proof, conflicting last-room
reservations, cancelled inventory, PMS check-in and check-out, readiness,
folio and Studio draft, publication and media access. The final-room race
admitted one reservation and returned a conflict for the other. The SQL
suite also covered cross-tenant reads, stale versions and repeated payment
and booking requests. Product and Core migration sources retained their
original checksums.

## Hosted measurements and limits

The Frankfurt QA database was created in the test project. The measurement
used the pooled TLS endpoint from the local development machine. The first
metadata RPC took 836 ms. The 20 subsequent samples had median 360 ms and
p95 410 ms. The query sequence also verified that the login role and claim
context were restored. No PostgREST variables or endpoint were needed. The
local app's development client chunks contained zero matches for the three
configured private hosted inputs across 107 files scanned. These figures
measure the local machine to the QA database. Vercel cold starts, production
load and cost were unmeasured.

Native removes one separately operated service. The pool defaults to four
data connections per app instance, with a permitted range of one to sixteen.
Better Auth has a separate pool. Budget both pools against the target
compute and expected instance count. Use a verified pooled URL for hosted
data, an unpooled migration URL and a separate least-privileged auth URL.

## Release gates

- **ENGINEERING_NO_GO**. The native Core and BookPlace suites passed. Full
  Supabase compatibility certification remains incomplete due to the
  fixture timeouts and disposable consumer startup failure.
- **HOSTED_PREVIEW_BLOCKED_EXTERNAL**. The Frankfurt database and
  full local-to-Neon product scenario passed. Vercel Preview binding and
  browser acceptance are pending.
- **PRODUCTION_NO_GO**. Production requires a separate rollout decision.

Repeat the remaining Supabase integration and critical browser checks and
the disposable consumer proof in a clean Docker environment. Then repeat the
hosted product run from a Vercel Preview linked only to the isolated Neon
test branch when that deployment is authorized. See [Neon setup](../NEON.md)
and [consumer upgrades](../UPGRADING.md) for configuration and rollback.
