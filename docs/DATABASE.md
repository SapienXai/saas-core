# Database

The migration in `supabase/migrations` is Core-owned. It creates workspace,
membership, plans, subscriptions, overrides, usage, invitations, webhook
inbox, audit, platform, domains, PWA and push tables. `supabase/seed.sql` is
local catalog data only.

Supabase migrations must remain one chronological stream. Ownership is recorded
in migration comments and the `saas_core_schema_versions` table tracks Core
schema compatibility. Product tables coexist without being modified by Core.
