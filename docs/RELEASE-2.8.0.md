# SaaS Core 2.8.0

Core 2.8.0 adds Neon Postgres as a backend for fresh installations. With
`NEXT_PUBLIC_SAAS_CORE_BACKEND=neon`, session and account records live in
Postgres through Better Auth. The application sends data requests through
PostgREST under the Core database roles. Workspace IDs, billing tables and
the RLS rules shared by the two backends retain the schema compatibility
coordinate `2.0`.

The release carries the Paddle default for new checkouts and routes existing
subscriptions through their recorded provider. Use [Neon setup](./NEON.md) to
configure a clean branch, register the signing keys and synchronize the
catalog. See [Upgrading](./UPGRADING.md) for the consumer update contract.

The runtime was verified with a fresh Neon Postgres database, PostgREST and
Mailpit. The Neon-managed Data API accepted the signing configuration but
returned HTTP 500 on data queries in the Vercel-managed test project. Use the
verified PostgREST path unless the managed endpoint passes the same checks on
your branch. Live payment provider rehearsals remain a deployment step.
