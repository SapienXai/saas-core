# Run SaaS Core on Neon

SaaS Core 2.8.0 supports a fresh Neon Postgres installation. The Next.js
application runs Better Auth against the same database and sends Core queries
through a PostgREST endpoint. The browser talks to the application. The database
connection and Data API signing key are server credentials.

1. Create a clean Neon branch and database. Use its direct connection for
   `DATABASE_URL_UNPOOLED`. Set `NEXT_PUBLIC_SAAS_CORE_BACKEND=neon` in both
   the build and runtime environment.
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
4. Set `DATABASE_URL` to the runtime Postgres connection on the same branch
   and `SAAS_CORE_AUTH_URL` to the canonical application origin. Set a random
   server-only `SAAS_CORE_AUTH_SECRET` of at least 32 bytes. Use a separate
   login for the runtime connection. For a role named `core_auth` on the
   `saas_core` database, configure its schema and privileges as follows:

   ```sql
   ALTER ROLE core_auth IN DATABASE saas_core SET search_path TO auth, public;
   GRANT USAGE ON SCHEMA auth TO core_auth;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO core_auth;
   GRANT SELECT (icon_url) ON public.workspace_pwa_settings TO core_auth;
   CREATE POLICY core_neon_assets_read ON public.workspace_pwa_settings
     FOR SELECT TO core_auth USING (true);
   ```

   Configure the application's Resend sender for verification and recovery
   email. For
   Google sign-in, set `SAAS_CORE_GOOGLE_CLIENT_ID` and
   `SAAS_CORE_GOOGLE_CLIENT_SECRET`, with the callback
   `/api/core-auth/callback/google` on the canonical origin.
5. Sync the product catalog with `pnpm billing:sync-catalog`. Verify
   signup and email confirmation, sign-in, workspace onboarding, cross-workspace
   access, invitations, billing webhooks and password recovery on the target
   branch before directing traffic to it.

The Data API roles must retain the Core grants and row-level policies from the
setup script. Never grant `service_role` to `anon` or `authenticated`. Keep
the signing key, Postgres URLs and Better Auth secret out of browser variables.

The same PostgREST contract can be exercised on a local PostgreSQL instance.
Local email delivery can use Mailpit.

This setup targets clean databases. Existing Supabase users, sessions,
Workspace UUIDs and object storage require a separate migration plan and
validation. Updating the npm packages copies source files only. An existing
consumer can continue using Supabase while planning that transition.

See [Neon Data API external authentication](https://neon.com/docs/data-api/custom-authentication-providers)
and [Neon Data API access control](https://neon.com/docs/data-api/access-control).

Before a production cutover, repeat the checks on the intended branch and
endpoint. See the [2.8.0 release notes](./RELEASE-2.8.0.md) for the verification
scope.
