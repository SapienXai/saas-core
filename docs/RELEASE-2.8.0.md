# SaaS Core 2.8.0

Core 2.8.0 adds Neon Postgres as a backend for fresh installations. With
`NEXT_PUBLIC_SAAS_CORE_BACKEND=neon`, session and account records live in
Postgres through Better Auth. The application sends data requests to the Neon
Data API under the Core database roles. Workspace IDs, billing tables and
the RLS rules shared by the two backends retain the schema compatibility
coordinate `2.0`.

The release carries the Paddle default for new checkouts and routes existing
subscriptions through their recorded provider. Use [Neon setup](./NEON.md) to
configure a clean branch, register the signing keys and synchronize the
catalog. See [Upgrading](./UPGRADING.md) for the consumer update contract.

The runtime was verified locally using PostgreSQL, PostgREST and Mailpit.
Managed Neon and real payment provider rehearsals are deployment verification
steps for the target environment.
