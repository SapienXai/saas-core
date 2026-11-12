# Run SaaS Core on Neon

New 2.9.0 consumers set `NEXT_PUBLIC_SAAS_CORE_BACKEND=neon` and
`SAAS_CORE_DATA_TRANSPORT=postgres` at build and runtime. Next.js uses
Better Auth and two server-only PostgreSQL connections. Native data access
requires PostgreSQL 16 or later, including Neon PostgreSQL 17 and 18.

1. Create a clean test database or identify the existing Neon branch to
   upgrade. Set `DATABASE_URL_UNPOOLED` to its direct setup connection.
2. Run `pnpm db:setup:neon` to apply the shared migrations and record their
   checksums. Existing Neon databases retain their account and Workspace IDs.
3. Create distinct least-privilege logins. For the data connection, use a
   role created in SQL, without membership in `neon_superuser`.

   ```sql
   CREATE ROLE core_data LOGIN NOINHERIT NOBYPASSRLS;
   ```

   Set the credential using your database administration tool. Set
   `SAAS_CORE_DATA_DATABASE_URL` to the data login on the same database.
   Use Neon's pooled endpoint and `sslmode=verify-full` for hosted traffic.
   Run `pnpm db:setup:neon --grant-data-role` to explicitly grant only
   `SET ROLE` membership for `anon`, `authenticated` and `service_role`.
   The native runtime checks the login and refuses unsafe grants.
4. Set `DATABASE_URL` to the Better Auth login on the same database. For an
   auth login named `core_auth` on database `saas_core`, configure:

   ```sql
   ALTER ROLE core_auth IN DATABASE saas_core SET search_path TO auth, public;
   GRANT USAGE ON SCHEMA auth TO core_auth;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO core_auth;
   GRANT SELECT (icon_url) ON public.workspace_pwa_settings TO core_auth;
   CREATE POLICY core_neon_assets_read ON public.workspace_pwa_settings
     FOR SELECT TO core_auth USING (true);
   ```

   Set `SAAS_CORE_AUTH_URL` to the application origin and use a random
   `SAAS_CORE_AUTH_SECRET` of at least 32 bytes. Configure the Resend sender
   and optional Google credentials. Google uses the callback
   `/api/core-auth/callback/google` on that origin.
5. Run `pnpm billing:sync-catalog` and check `saas-core doctor` with the
   target runtime credentials. Exercise signup, verification, Workspace access,
   invitations, billing reconciliation and password recovery on the test branch.

The native connection pool defaults to four connections per process. Lower
`SAAS_CORE_DATA_POOL_MAX` for highly concurrent serverless deployments and
budget connections across processes. A connection waits up to five seconds
for acquisition and each PostgreSQL statement has an eight-second deadline.
`SAAS_CORE_DATA_TIMINGS=1` logs elapsed time without query arguments.

## Existing Neon PostgREST deployments

Leaving the transport unset keeps the 2.8 PostgREST behavior. An explicit
`postgrest` setting does the same. Keep the existing endpoint, audience and
signing key for rollback to that transport. The JWKS route serves keys only
for the PostgREST transport. With `postgres` the app requires neither
`NEON_DATA_API_URL`, `SAAS_CORE_DATA_SIGNING_KEY` nor `SAAS_CORE_DATA_AUDIENCE`.

Use the existing managed Data API or PostgREST setup for legacy mode.
2. Generate a deployment-specific RSA key with at least 2048 bits. Store the
   private PEM in `SAAS_CORE_DATA_SIGNING_KEY` as a server secret. Use
   `SAAS_CORE_DATA_AUDIENCE` for a unique audience. The application signs
   short-lived tokens for the verified user or the server role. The public
   key is available at `https://<app-origin>/api/core-data/jwks` once the
   application is running with the signing key.
3. Choose an endpoint for `NEON_DATA_API_URL`:

   - **PostgREST:** Run `pnpm db:setup:neon` (or
     `node --env-file=.env.local scripts/setup-neon.mjs`) to apply the Core
     schema. Connect PostgREST to the same Neon database with a dedicated
     `LOGIN NOINHERIT` role. Grant only `anon`, `authenticated` and
     `service_role` to that login. Configure `PGRST_DB_SCHEMAS=public`,
     `PGRST_DB_ANON_ROLE=anon`, `PGRST_OPENAPI_MODE=disabled`, the public JWK
     set in `PGRST_JWT_SECRET` and the same audience in `PGRST_JWT_AUD`.
     Use verified TLS for the Neon connection and HTTPS for the endpoint
     in production. The application allows HTTP on loopback for development.
   - **Neon-managed Data API:** Before running the Core setup script, enable
     the API with external JWT authentication, the public JWKS URL and the
     same audience. Expose only `public`, skip creating the auth schema and
     disable automatic default grants. Set the anonymous role to `anon`.
     Then run the setup script. Grant `anon` and `service_role` to
     `authenticator`; Neon already grants it `authenticated`. Refresh the
     Data API schema cache and verify an authenticated and a server-role
     query before using this endpoint.

   The setup script checks the target, records migration checksums and
   leaves the shared Core migration files intact.
On a fresh native deployment, local PostgreSQL and Mailpit are sufficient.
Supabase consumers keep their backend selection. Moving their existing
identity or data to Neon is a separate database migration.

[Architecture and inventory](./architecture/NATIVE-POSTGRES-ADR.md)
