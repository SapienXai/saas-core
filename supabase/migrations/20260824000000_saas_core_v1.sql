-- SaaS Core v1.0.0. Ownership: core.
-- Product migrations use later timestamps and reference workspaces directly.

create schema if not exists private;

create table if not exists public.saas_core_schema_versions (
  version text primary key,
  package_version text not null,
  applied_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  preferred_timezone text not null default 'UTC',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'member', 'viewer')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members(user_id, status);
create index if not exists workspace_members_workspace_idx on public.workspace_members(workspace_id, status);

create table if not exists public.plans (
  key text primary key,
  name text not null,
  active boolean not null default true,
  billing jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_key text not null references public.plans(key),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'paused', 'canceled')),
  source text not null default 'free' check (source in ('free', 'manual', 'system', 'paddle')),
  provider text check (provider is null or provider in ('paddle')),
  provider_environment text check (provider_environment is null or provider_environment in ('sandbox', 'live')),
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  scheduled_plan_key text references public.plans(key),
  scheduled_plan_at timestamptz,
  payment_failure_started_at timestamptz,
  payment_grace_ends_at timestamptz,
  billing_issue_code text,
  last_provider_event_at timestamptz,
  last_provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scheduled_plan_key is null) = (scheduled_plan_at is null)),
  check ((current_period_start is null and current_period_end is null) or current_period_end > current_period_start),
  unique (provider, provider_environment, provider_subscription_id)
);

create table if not exists public.subscription_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_key text not null references public.plans(key),
  reason text not null check (length(trim(reason)) > 0),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from)
);

create index if not exists subscription_overrides_active_idx on public.subscription_overrides(workspace_id, effective_from desc) where revoked_at is null;

create table if not exists public.workspace_usage_periods (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  metric text not null check (metric ~ '^[a-z][a-z0-9_.-]{0,95}$'),
  period_start date not null,
  period_end date not null,
  amount bigint not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, metric, period_start),
  check (period_end > period_start)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  normalized_email text not null check (normalized_email = lower(trim(normalized_email)) and length(normalized_email) between 3 and 320),
  role text not null check (role in ('admin', 'manager', 'member', 'viewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  email_delivery_status text not null default 'pending' check (email_delivery_status in ('pending', 'sent', 'failed')),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_invitations_seat_idx on public.workspace_invitations(workspace_id, status, expires_at);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('paddle')),
  provider_event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  provider_object_id text,
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  payload jsonb not null,
  error_code text,
  error_message text,
  processing_started_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists billing_webhook_events_status_idx on public.billing_webhook_events(status, created_at);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_entity_idx on public.audit_events(entity_type, entity_id, created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events(actor_user_id, created_at desc);

create table if not exists public.platform_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('platform_owner', 'platform_admin', 'billing_admin', 'support', 'auditor')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hostname text not null unique,
  status text not null default 'pending' check (status in ('pending', 'verified', 'active', 'error', 'suspended')),
  verification_state text not null default 'pending' check (verification_state in ('pending', 'verified', 'failed')),
  dns_configured boolean not null default false,
  ssl_state text not null default 'pending' check (ssl_state in ('pending', 'provisioned', 'failed')),
  provider_domain_id text,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create table if not exists public.workspace_pwa_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  app_name text,
  icon_url text,
  theme_color text,
  background_color text,
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, endpoint)
);

create or replace function private.current_user_is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid() and status = 'active');
$$;

create or replace function private.current_user_has_workspace_role(target_workspace uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid() and status = 'active' and role = any(allowed_roles));
$$;

create or replace function private.current_user_is_platform_member(allowed_roles text[] default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_members where user_id = auth.uid() and status = 'active' and (allowed_roles is null or role = any(allowed_roles)));
$$;

revoke all on function private.current_user_is_workspace_member(uuid) from public, anon;
revoke all on function private.current_user_has_workspace_role(uuid, text[]) from public, anon;
revoke all on function private.current_user_is_platform_member(text[]) from public, anon;
grant execute on function private.current_user_is_workspace_member(uuid) to authenticated;
grant execute on function private.current_user_has_workspace_role(uuid, text[]) to authenticated;
grant execute on function private.current_user_is_platform_member(text[]) to authenticated;

create or replace function private.ensure_free_subscription()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.workspace_subscriptions(workspace_id, plan_key, status, source) values (new.id, 'free', 'active', 'free') on conflict (workspace_id) do nothing;
  return new;
end;
$$;

drop trigger if exists workspaces_create_free_subscription on public.workspaces;
create trigger workspaces_create_free_subscription after insert on public.workspaces for each row execute function private.ensure_free_subscription();

create or replace function private.consume_usage(target_workspace uuid, target_metric text, increment_by bigint default 1)
returns table (period_start date, period_end date, amount bigint, remaining bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  bucket_start date := date_trunc('month', timezone('utc', now()))::date;
  bucket_end date := (date_trunc('month', timezone('utc', now())) + interval '1 month')::date;
  usage_limit bigint;
begin
  if increment_by < 1 then raise exception using errcode = '22023', message = 'increment_by must be positive'; end if;
  select nullif((p.limits ->> target_metric), '')::bigint into usage_limit from public.workspace_subscriptions s join public.plans p on p.key = s.plan_key where s.workspace_id = target_workspace;
  insert into public.workspace_usage_periods(workspace_id, metric, period_start, period_end, amount) values (target_workspace, target_metric, bucket_start, bucket_end, 0) on conflict (workspace_id, metric, period_start) do nothing;
  select w.amount into amount from public.workspace_usage_periods w where w.workspace_id = target_workspace and w.metric = target_metric and w.period_start = bucket_start for update;
  if usage_limit is not null and amount + increment_by > usage_limit then raise exception using errcode = 'P0001', message = 'LIMIT_REACHED'; end if;
  update public.workspace_usage_periods w set amount = w.amount + increment_by, updated_at = now() where w.workspace_id = target_workspace and w.metric = target_metric and w.period_start = bucket_start returning w.period_start, w.period_end, w.amount into period_start, period_end, amount;
  remaining := case when usage_limit is null then null else greatest(0, usage_limit - amount) end;
  return next;
end;
$$;

revoke all on function private.consume_usage(uuid, text, bigint) from public, anon, authenticated;
grant execute on function private.consume_usage(uuid, text, bigint) to service_role;

create or replace function private.create_workspace_invitation(target_workspace uuid, target_email text, target_role text, target_token_hash text, target_expires_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  invitation_id uuid;
  seat_limit bigint;
  active_seats bigint;
  pending_seats bigint;
begin
  if not private.current_user_has_workspace_role(target_workspace, array['owner','admin']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select nullif((p.limits ->> 'users'), '')::bigint into seat_limit from public.workspace_subscriptions s join public.plans p on p.key = s.plan_key where s.workspace_id = target_workspace for update;
  select count(*) into active_seats from public.workspace_members where workspace_id = target_workspace and status = 'active';
  select count(*) into pending_seats from public.workspace_invitations where workspace_id = target_workspace and status = 'pending' and expires_at > now();
  if seat_limit is not null and active_seats + pending_seats + 1 > seat_limit then raise exception using errcode = 'P0001', message = 'LIMIT_REACHED'; end if;
  insert into public.workspace_invitations(workspace_id, normalized_email, role, token_hash, invited_by, expires_at)
  values (target_workspace, lower(trim(target_email)), target_role, target_token_hash, auth.uid(), target_expires_at)
  returning id into invitation_id;
  return invitation_id;
end;
$$;

create or replace function private.accept_workspace_invitation(target_invitation uuid, target_token_hash text)
returns public.workspace_members
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  invitation public.workspace_invitations;
  new_member public.workspace_members;
  account_email text;
  seat_limit bigint;
  active_seats bigint;
begin
  select * into invitation from public.workspace_invitations where id = target_invitation for update;
  if invitation.id is null or invitation.status <> 'pending' or invitation.revoked_at is not null or invitation.expires_at <= now() or invitation.token_hash <> target_token_hash then raise exception using errcode = 'P0001', message = 'INVITATION_INVALID'; end if;
  select lower(email) into account_email from auth.users where id = auth.uid();
  if account_email is null or account_email <> invitation.normalized_email then raise exception using errcode = 'P0001', message = 'INVITATION_INVALID'; end if;
  select nullif((p.limits ->> 'users'), '')::bigint into seat_limit from public.workspace_subscriptions s join public.plans p on p.key = s.plan_key where s.workspace_id = invitation.workspace_id for update;
  select count(*) into active_seats from public.workspace_members where workspace_id = invitation.workspace_id and status = 'active';
  if seat_limit is not null and active_seats >= seat_limit then raise exception using errcode = 'P0001', message = 'LIMIT_REACHED'; end if;
  insert into public.workspace_members(workspace_id, user_id, role) values (invitation.workspace_id, auth.uid(), invitation.role) returning * into new_member;
  update public.workspace_invitations set status = 'accepted', accepted_at = now() where id = invitation.id;
  return new_member;
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'CONFLICT';
end;
$$;

revoke all on function private.create_workspace_invitation(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.accept_workspace_invitation(uuid, text) from public, anon;
grant execute on function private.create_workspace_invitation(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function private.accept_workspace_invitation(uuid, text) to authenticated;

do $$ begin
  insert into public.plans(key, name, active, billing, features, limits)
  values
    ('free', 'Free', true, '{"currency":"USD","monthlyPriceCents":0}', '{"core":true}', '{"users":1,"api_calls":1000}'),
    ('starter', 'Starter', true, '{"currency":"USD","monthlyPriceCents":1900}', '{"core":true}', '{"users":3,"api_calls":10000}'),
    ('pro', 'Pro', true, '{"currency":"USD","monthlyPriceCents":4900}', '{"core":true,"customDomain":true,"customPWA":true,"pushNotifications":true}', '{"users":10,"api_calls":100000}'),
    ('business', 'Business', true, '{"currency":"USD","monthlyPriceCents":9900}', '{"core":true,"customDomain":true,"customPWA":true,"pushNotifications":true,"auditExports":true}', '{"users":25,"api_calls":null}')
  on conflict (key) do nothing;
end $$;

insert into public.saas_core_schema_versions(version, package_version) values ('1', '1.0.0') on conflict (version) do update set package_version = excluded.package_version;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.plans enable row level security;
alter table public.workspace_subscriptions enable row level security;
alter table public.subscription_overrides enable row level security;
alter table public.workspace_usage_periods enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.platform_members enable row level security;
alter table public.workspace_domains enable row level security;
alter table public.workspace_pwa_settings enable row level security;
alter table public.workspace_push_subscriptions enable row level security;

drop policy if exists workspace_member_read on public.workspaces;
create policy workspace_member_read on public.workspaces for select to authenticated using (private.current_user_is_workspace_member(id));
drop policy if exists workspace_owner_update on public.workspaces;
create policy workspace_owner_update on public.workspaces for update to authenticated using (private.current_user_has_workspace_role(id, array['owner','admin'])) with check (private.current_user_has_workspace_role(id, array['owner','admin']));

drop policy if exists workspace_members_read on public.workspace_members;
create policy workspace_members_read on public.workspace_members for select to authenticated using (private.current_user_is_workspace_member(workspace_id));
drop policy if exists workspace_members_mutate on public.workspace_members;
create policy workspace_members_mutate on public.workspace_members for all to authenticated using (private.current_user_has_workspace_role(workspace_id, array['owner','admin'])) with check (private.current_user_has_workspace_role(workspace_id, array['owner','admin']));

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans for select to anon, authenticated using (active = true);

drop policy if exists subscriptions_member_read on public.workspace_subscriptions;
create policy subscriptions_member_read on public.workspace_subscriptions for select to authenticated using (private.current_user_is_workspace_member(workspace_id));
drop policy if exists overrides_owner_read on public.subscription_overrides;
create policy overrides_owner_read on public.subscription_overrides for select to authenticated using (private.current_user_has_workspace_role(workspace_id, array['owner','admin']));
drop policy if exists usage_member_read on public.workspace_usage_periods;
create policy usage_member_read on public.workspace_usage_periods for select to authenticated using (private.current_user_is_workspace_member(workspace_id));
drop policy if exists invitation_owner_read on public.workspace_invitations;
create policy invitation_owner_read on public.workspace_invitations for select to authenticated using (private.current_user_has_workspace_role(workspace_id, array['owner','admin']));
drop policy if exists audit_workspace_read on public.audit_events;
create policy audit_workspace_read on public.audit_events for select to authenticated using (entity_type = 'workspace' and entity_id ~ '^[0-9a-fA-F-]{36}$' and private.current_user_is_workspace_member(entity_id::uuid));
drop policy if exists audit_platform_read on public.audit_events;
create policy audit_platform_read on public.audit_events for select to authenticated using (private.current_user_is_platform_member(array['platform_owner','platform_admin','support','auditor']));
drop policy if exists platform_member_read on public.platform_members;
create policy platform_member_read on public.platform_members for select to authenticated using (private.current_user_is_platform_member(array['platform_owner','platform_admin','support','auditor']));
drop policy if exists domain_owner_read on public.workspace_domains;
create policy domain_owner_read on public.workspace_domains for select to authenticated using (private.current_user_is_workspace_member(workspace_id));
drop policy if exists pwa_member_read on public.workspace_pwa_settings;
create policy pwa_member_read on public.workspace_pwa_settings for select to authenticated using (private.current_user_is_workspace_member(workspace_id));
drop policy if exists push_owner_read on public.workspace_push_subscriptions;
create policy push_owner_read on public.workspace_push_subscriptions for select to authenticated using (user_id = auth.uid() and private.current_user_is_workspace_member(workspace_id));

comment on table public.workspace_subscriptions is 'Core local commercial authority. Provider state is evidence, not runtime authorization.';
comment on table public.workspace_invitations is 'Only SHA-256 token hashes are stored; pending rows reserve seats.';
comment on table public.audit_events is 'Security-sensitive core and platform actions must write an audit event.';
