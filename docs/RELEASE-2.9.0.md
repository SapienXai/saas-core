# SaaS Core 2.9.0 candidate

Core 2.9.0 adds a server-side native PostgreSQL transport for Neon. New
consumers select it in the environment template. Existing Supabase and
Neon PostgREST consumers retain their backend selection. The Core schema
compatibility coordinate remains 2.0.

See [Neon setup](./NEON.md), the [architecture decision](./architecture/NATIVE-POSTGRES-ADR.md)
and [validation](./validation/NATIVE-POSTGRES-CERTIFICATION.md).
