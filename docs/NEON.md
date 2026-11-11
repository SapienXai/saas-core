# Run SaaS Core on Neon

SaaS Core 2.8.0 supports a fresh Neon Postgres installation. The Next.js
application runs Better Auth against the same database and sends Core queries
to the Neon Data API. The browser talks to the application. The database
connection and Data API signing key are server credentials.

1. Create a clean Neon branch and database. Use its direct connection for
   `DATABASE_URL_UNPOOLED`. Set `NEXT_PUBLIC_SAAS_CORE_BACKEND=neon` in both
   the build and runtime environment. Run `pnpm db:setup:neon` or
   `node --env-file=.env.local scripts/setup-neon.mjs` from the application.
   The setup checks the target, records migration checksums and leaves the
   existing Core migrations intact.
2. Enable the Neon Data API for the database with external JWT
   authentication. Expose only `public`, skip creating the auth schema and
   leave automatic default grants off. Set the anonymous role to `anon`.
   After provisioning, grant `anon`, `authenticated` and `service_role` to
   the Data API authenticator. These roles need no password or login.
3. Generate a deployment-specific RSA key with at least 2048 bits. Store the
   private PEM in `SAAS_CORE_DATA_SIGNING_KEY` as a server secret. Use
   `https://<app-origin>/api/core-data/jwks` as the external provider JWKS URL.
   Configure the same unique audience in Neon and `SAAS_CORE_DATA_AUDIENCE`.
   Set `NEON_DATA_API_URL` to the Data API base URL for this branch. The
   application signs short-lived tokens using the user from its verified
   session or its server role, depending on the operation.
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

The same contract can be exercised locally with PostgreSQL and PostgREST
configured with the public JWK set, the same audience, and the three database
roles. Local email delivery can use Mailpit.

This setup targets clean databases. Existing Supabase users, sessions,
Workspace UUIDs and object storage require a separate migration plan and
validation. Updating the npm packages copies source files only. An existing
consumer can continue using Supabase while planning that transition.

See [Neon Data API external authentication](https://neon.com/docs/data-api/custom-authentication-providers)
and [Neon Data API access control](https://neon.com/docs/data-api/access-control).

The release verification ran against local PostgreSQL, PostgREST and Mailpit.
Repeat the checks on the intended managed Neon branch, including the externally
hosted JWKS configuration, before a production cutover.
