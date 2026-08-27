-- Reservevia platform administration foundation.
-- Platform roles are intentionally separate from workspace membership roles.
-- These tables are server-controlled and are never exposed to browser roles.

create table if not exists public.platform_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('platform_owner', 'platform_admin', 'billing_admin', 'support', 'auditor')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_members_role_status_idx
  on public.platform_members (role, status);

create table if not exists public.platform_user_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  reason text,
  suspended_by uuid references auth.users(id) on delete set null,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_user_controls_status_idx
  on public.platform_user_controls (status, updated_at desc);

create table if not exists public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (length(btrim(action)) > 0),
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id text,
  before_data jsonb not null default '{}'::jsonb check (jsonb_typeof(before_data) = 'object'),
  after_data jsonb not null default '{}'::jsonb check (jsonb_typeof(after_data) = 'object'),
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_logs_created_idx
  on public.platform_audit_logs (created_at desc);
create index if not exists platform_audit_logs_actor_idx
  on public.platform_audit_logs (actor_user_id, created_at desc);
create index if not exists platform_audit_logs_entity_idx
  on public.platform_audit_logs (entity_type, entity_id, created_at desc);

create table if not exists public.platform_settings (
  key text primary key check (key in ('maintenance_mode', 'maintenance_message', 'signup_enabled', 'support_email', 'default_locale', 'default_timezone')),
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_key text not null references public.plans(key),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_overrides_period_check check (
    effective_until is null or effective_until > effective_from
  )
);

create index if not exists subscription_overrides_workspace_effective_idx
  on public.subscription_overrides (workspace_id, effective_from desc, effective_until);
create index if not exists subscription_overrides_active_idx
  on public.subscription_overrides (workspace_id, effective_from desc)
  where revoked_at is null;

alter table public.workspaces
  add column if not exists platform_status text not null default 'active';

alter table public.restaurants
  add column if not exists platform_status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspaces_platform_status_check'
      and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      add constraint workspaces_platform_status_check
      check (platform_status in ('active', 'suspended', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_platform_status_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_platform_status_check
      check (platform_status in ('active', 'suspended', 'archived'));
  end if;
end $$;

create index if not exists workspaces_platform_status_idx
  on public.workspaces (platform_status, updated_at desc);
create index if not exists restaurants_platform_status_idx
  on public.restaurants (platform_status, updated_at desc);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'platform_members_set_updated_at') then
    create trigger platform_members_set_updated_at
      before update on public.platform_members
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'platform_user_controls_set_updated_at') then
    create trigger platform_user_controls_set_updated_at
      before update on public.platform_user_controls
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'platform_settings_set_updated_at') then
    create trigger platform_settings_set_updated_at
      before update on public.platform_settings
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'subscription_overrides_set_updated_at') then
    create trigger subscription_overrides_set_updated_at
      before update on public.subscription_overrides
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.platform_members enable row level security;
alter table public.platform_user_controls enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.platform_settings enable row level security;
alter table public.subscription_overrides enable row level security;

revoke all on public.platform_members from anon, authenticated;
revoke all on public.platform_user_controls from anon, authenticated;
revoke all on public.platform_audit_logs from anon, authenticated;
revoke all on public.platform_settings from anon, authenticated;
revoke all on public.subscription_overrides from anon, authenticated;

grant all on public.platform_members to service_role;
grant all on public.platform_user_controls to service_role;
grant all on public.platform_audit_logs to service_role;
grant all on public.platform_settings to service_role;
grant all on public.subscription_overrides to service_role;

comment on table public.platform_members is 'Reservevia platform staff roles. Separate from workspace membership and server-controlled.';
comment on table public.platform_user_controls is 'Platform-level user suspension state. Suspension is separate from authentication deletion.';
comment on table public.platform_audit_logs is 'Immutable-by-convention audit trail for platform administration actions.';
comment on table public.platform_settings is 'Non-secret platform settings only. Secrets remain deployment environment variables.';
comment on table public.subscription_overrides is 'Temporary or manual entitlement overrides; Paddle subscription state remains untouched.';
comment on column public.workspaces.platform_status is 'Platform moderation state; workspace.status remains the customer lifecycle state.';
comment on column public.restaurants.platform_status is 'Platform moderation state; restaurant.status remains the public publishing state.';

notify pgrst, 'reload schema';
