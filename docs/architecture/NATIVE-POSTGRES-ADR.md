# Native PostgreSQL for SaaS Core 2.9

Status: implementation candidate. Runtime/package version 2.9.0, schema compatibility 2.0.

## Context and decision

In 2.8, the browser calls Next.js. Better Auth verifies a session using one PostgreSQL login. The server then creates a separate signed identity and sends a REST request to PostgREST. The database checks the REST role and `auth.uid()`.

The native transport keeps the same Next.js and Better Auth boundaries. The verified request identity selects a database role and supplies claims inside one transaction on a pinned `pg` client. The database remains responsible for grants, RLS and transactional business functions. Auth and application data use different logins. Native calls require neither a REST endpoint nor signing material.

Use a structured table and function contract, with a bounded fluent interface for the deployed source shapes. Reuse the existing REST SDK for legacy transports. Reject unsupported shapes on native; move the few compound predicates and embedded relations to explicit structured filters and foreign key references. Database grants determine the public function surface. Supabase authentication and the existing Neon PostgREST transport remain available for consumers that keep their 2.8 configuration.

## Inventory at the baseline

Core was inspected at `c5afc38` and BookPlace at `952ee30`. The following counts are lexical matches in Core `app`, `lib` and `scripts`, and in BookPlace product source and product routes. Some matches are unrelated JavaScript methods.

| Shape | Core | BookPlace product | Representative entry |
| --- | ---: | ---: | --- |
| `from` / `rpc` / `select` | 247 / 35 / 168 | 24 / 2 / 17 | Core `lib/billing/persistence.ts:216`, BookPlace `src/product/server.ts:40` |
| `maybeSingle` / `single` | 94 / 29 | 8 / 1 | Core `lib/auth-utils.ts:51`, BookPlace `src/product/server.ts:51` |
| `insert` / `update` / `delete` / `upsert` | 17 / 55 / 19 / 13 | 0 / 2 / 0 / 0 | Core `app/manage/pwa/actions.ts:95`, BookPlace `src/product/server.ts` |
| `eq` / `in` / `or` / `not` | 337 / 11 / 4 / 2 | 19 / 0 / 1 / 0 | Core `lib/billing/lifecycle.ts:87`, BookPlace `src/product/server.ts:124` |
| Foreign key embedding | 2 | 2 | `lib/auth-utils.ts:82`, `app/invite/accept/page.tsx:24`, BookPlace `src/product/server.ts:123` |
| Count with head, ordering, bounds | used | used | Core `lib/platform-admin.ts:258`, BookPlace `src/product/usage.ts:6` |
| Auth / object storage | separate adapter | Core auth and product media | `lib/neon/auth.ts`, `lib/neon/storage.ts` |

Simple projections, comparisons, null checks, IN, ordering, limits, filtered writes, conflict keys and bulk inserts are shared shapes. BookPlace's PMS filter has two nested AND groups inside an OR. Its guest join uses the composite `(workspace_id, guest_id)` foreign key. The published Studio snapshot uses the reverse one-to-one property key. The inventory did not find a product need for REST schema switching, a full select expression language or dynamic schema search.

## Permissions and atomicity

| Identity | Boundary |
| --- | --- |
| Data login | LOGIN, NOINHERIT, NOBYPASSRLS. Can select only the three application roles with SET ROLE. Owns no application objects. |
| anon | Existing public table and function grants plus RLS. No private guest, folio or staff reads. |
| authenticated | Existing authenticated grants and RLS using the verified session's UUID. Workspace roles remain distinct from database roles. |
| service_role | Server-only grants and explicit RLS policies. No BYPASSRLS. Operator and product server entry points authorize the actor before selecting it. |
| Auth login | Separate Better Auth connection. The only Core data grant is the PWA asset reference required by the storage adapter. |
| Migration owner | Applies the existing SQL and explicit role setup. Its credentials do not belong in the app runtime. |

Use `BEGIN`, local search path, an allowlisted `SET LOCAL ROLE`, and transaction-local `request.jwt.claims`. Commit only after query processing succeeds. Roll back on failure and discard a client whose rollback fails. No named prepared statements, persistent session settings or client-supplied role selection.

Preserve the migration checksums. Existing SECURITY DEFINER functions keep their qualified schema, search path, and EXECUTE grants. Core workspace and entitlement locks, provider event leases and idempotency receipts, and BookPlace inventory exclusions and transactional reservation, front desk, folio and studio functions stay in SQL. The transport does not split those transactions or retry an ambiguous write.

An ORM migration would still need the same role/claim transaction and a wide source migration. A PostgREST emulator would add an expression language and duplicate authorization-sensitive behavior. An HTTP-only SQL driver would require a separate transaction design. Reusing node-postgres gives a bounded pool and explicit connection pinning in the Next.js Node runtime.

Sources: [PostgreSQL SET ROLE](https://www.postgresql.org/docs/current/sql-set-role.html), [PostgreSQL GRANT](https://www.postgresql.org/docs/current/sql-grant.html), [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).
