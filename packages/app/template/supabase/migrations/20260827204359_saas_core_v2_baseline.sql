-- SaaS Core 2.0 clean baseline.
--
-- This migration is intentionally independent from any product database. The
-- only tenancy boundary owned here is Workspace; product domains attach to it
-- with their own workspace_id foreign key and their own RLS policies.

create extension if not exists pgcrypto;

create schema if not exists private;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.plans (
  key text primary key check (key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text not null,
  sort_order integer not null check (sort_order >= 0),
  active boolean not null default true,
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plans_active_sort_idx on public.plans (active, sort_order);

create table private.core_schema_metadata (
  singleton boolean primary key default true check (singleton),
  schema_version text not null,
  runtime_major integer not null check (runtime_major > 0),
  updated_at timestamptz not null default now()
);

insert into private.core_schema_metadata (singleton, schema_version, runtime_major)
values (true, '2.0', 2);

create table private.core_settings (
  singleton boolean primary key default true check (singleton),
  default_plan_key text references public.plans(key),
  updated_at timestamptz not null default now()
);

insert into private.core_settings (singleton, default_plan_key)
values (true, null);

alter table private.core_schema_metadata enable row level security;
alter table private.core_settings enable row level security;
revoke all on table private.core_schema_metadata, private.core_settings from public, anon, authenticated;
grant all on table private.core_schema_metadata, private.core_settings to service_role;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'archived')),
  platform_status text not null default 'active' check (platform_status in ('active', 'suspended', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index workspaces_slug_key on public.workspaces (slug);
create index workspaces_created_by_idx on public.workspaces (created_by);
create index workspaces_platform_status_idx on public.workspaces (platform_status, updated_at desc);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'admin', 'manager', 'staff', 'readonly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);
create index workspace_members_workspace_idx on public.workspace_members (workspace_id);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (length(btrim(email)) between 3 and 320),
  role text not null default 'staff' check (role in ('admin', 'manager', 'staff', 'readonly')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  last_sent_at timestamptz,
  email_delivery_status text not null default 'pending' check (email_delivery_status in ('pending', 'sent', 'failed')),
  delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_invitations_workspace_pending_idx on public.workspace_invitations (workspace_id, expires_at desc) where accepted_at is null and revoked_at is null;

create table public.workspace_subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_key text not null references public.plans(key),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'paused')),
  source text not null default 'system' check (source in ('manual', 'system', 'paddle')),
  current_period_start date,
  current_period_end date,
  provider text check (provider is null or provider = 'paddle'),
  provider_environment text check (provider_environment is null or provider_environment in ('sandbox', 'live')),
  provider_customer_id text,
  provider_subscription_id text,
  provider_price_id text,
  provider_status text,
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  billing_currency text check (billing_currency is null or billing_currency ~ '^[A-Z]{3}$'),
  current_period_start_at timestamptz,
  current_period_end_at timestamptz,
  cancel_at_period_end boolean not null default false,
  last_provider_event_at timestamptz,
  last_provider_event_id text,
  next_billed_at timestamptz,
  scheduled_change_at timestamptz,
  scheduled_change_action text check (scheduled_change_action is null or scheduled_change_action in ('cancel', 'pause', 'resume')),
  scheduled_plan_key text references public.plans(key),
  scheduled_plan_at timestamptz,
  scheduled_effective_at timestamptz,
  scheduled_plan_interval text check (scheduled_plan_interval is null or scheduled_plan_interval in ('month', 'year')),
  scheduled_provider_price_id text,
  payment_failure_started_at timestamptz,
  payment_grace_ends_at timestamptz,
  billing_issue_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((current_period_start is null and current_period_end is null) or (current_period_start is not null and current_period_end is not null and current_period_end > current_period_start)),
  check (scheduled_plan_key is not null or scheduled_provider_price_id is null)
);

create unique index workspace_subscriptions_provider_subscription_key on public.workspace_subscriptions (provider, provider_environment, provider_subscription_id) where provider_subscription_id is not null;
create index workspace_subscriptions_plan_idx on public.workspace_subscriptions (plan_key);
create index workspace_subscriptions_scheduled_effective_idx on public.workspace_subscriptions (scheduled_effective_at) where scheduled_effective_at is not null;

create table public.workspace_usage_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, period_start, period_end),
  check (period_end > period_start)
);

create index workspace_usage_periods_workspace_period_idx on public.workspace_usage_periods (workspace_id, period_start desc, period_end desc);

create table public.billing_provider_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'paddle'),
  environment text not null check (environment in ('sandbox', 'live')),
  plan_key text not null references public.plans(key),
  provider_product_id text not null check (length(btrim(provider_product_id)) > 0),
  provider_price_id text not null check (length(btrim(provider_price_id)) > 0),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, environment, provider_price_id)
);

create unique index billing_provider_prices_active_plan_key on public.billing_provider_prices (provider, environment, plan_key, billing_interval, currency) where active = true;
create index billing_provider_prices_lookup_idx on public.billing_provider_prices (provider, environment, plan_key, active);

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'paddle'),
  provider_event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  provider_object_id text,
  workspace_id uuid references public.workspaces(id) on delete set null,
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  processing_started_at timestamptz,
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index billing_webhook_events_processing_idx on public.billing_webhook_events (provider, status, received_at);
create index billing_webhook_events_workspace_idx on public.billing_webhook_events (workspace_id, occurred_at desc);

create table public.billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'paddle' check (provider = 'paddle'),
  environment text not null check (environment in ('sandbox', 'live')),
  target_plan_key text not null references public.plans(key),
  provider_price_id text not null,
  provider_transaction_id text,
  idempotency_key text not null,
  status text not null default 'created' check (status in ('created', 'completed', 'expired', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, environment, idempotency_key),
  unique (provider, environment, provider_transaction_id)
);

create index billing_checkout_sessions_workspace_idx on public.billing_checkout_sessions (workspace_id, created_at desc);

create table public.billing_mutations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_key text not null check (length(btrim(request_key)) between 16 and 100),
  operation text not null check (operation in ('checkout', 'plan_change', 'cancel', 'resume', 'payment_recovery')),
  fingerprint text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, request_key)
);

create unique index billing_mutations_one_pending_workspace on public.billing_mutations (workspace_id) where status in ('pending', 'unknown');
create index billing_mutations_workspace_created_idx on public.billing_mutations (workspace_id, created_at desc);

create table public.billing_cancellation_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_subscription_id text,
  reason_code text not null,
  feedback text,
  created_at timestamptz not null default now(),
  check (length(btrim(reason_code)) > 0),
  check (feedback is null or length(feedback) <= 1000)
);

create index billing_cancellation_feedback_workspace_idx on public.billing_cancellation_feedback (workspace_id, created_at desc);

create table public.workspace_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hostname text not null unique,
  status text not null default 'verifying' check (status in ('verifying', 'active', 'error', 'removing', 'removed')),
  provider text not null default 'vercel',
  provider_environment text not null default 'production',
  verification_state text not null default 'pending' check (verification_state in ('pending', 'verified', 'failed')),
  provider_verified boolean not null default false,
  dns_configured boolean not null default false,
  verified_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create index workspace_domains_status_idx on public.workspace_domains (status, last_checked_at desc);

create table public.workspace_pwa_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  app_name text check (app_name is null or length(btrim(app_name)) between 1 and 60),
  icon_url text,
  theme_color text not null default '#1e40af' check (theme_color ~ '^#[0-9a-fA-F]{6}$'),
  background_color text not null default '#ffffff' check (background_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, endpoint)
);

create index workspace_push_subscriptions_workspace_status_idx on public.workspace_push_subscriptions (workspace_id, status, user_id);
create index workspace_push_subscriptions_user_status_idx on public.workspace_push_subscriptions (user_id, status);

create table public.subscription_overrides (
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
  check (effective_until is null or effective_until > effective_from)
);

create index subscription_overrides_active_idx on public.subscription_overrides (workspace_id, effective_from desc) where revoked_at is null;

create table public.platform_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('platform_owner', 'platform_admin', 'billing_admin', 'support', 'auditor')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_user_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  reason text,
  suspended_by uuid references auth.users(id) on delete set null,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_audit_logs (
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

create index platform_audit_logs_created_idx on public.platform_audit_logs (created_at desc);
create index platform_audit_logs_entity_idx on public.platform_audit_logs (entity_type, entity_id, created_at desc);

create table public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,80}$'),
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  kind text not null check (length(btrim(kind)) > 0),
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending', 'retrying', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'paused')),
  provider text,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  dedupe_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text,
  last_provider_event_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_delivery_events_outbox_idx on public.email_delivery_events (status, next_attempt_at, created_at);
create index email_delivery_events_provider_message_idx on public.email_delivery_events (provider, provider_message_id) where provider_message_id is not null;

create table public.email_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_event_id uuid not null references public.email_delivery_events(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('sending', 'sent', 'retrying', 'failed')),
  provider_message_id text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (delivery_event_id, attempt_number)
);

create table public.email_provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  provider_message_id text not null,
  event_type text not null,
  event_at timestamptz,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create index email_provider_webhook_events_message_idx on public.email_provider_webhook_events (provider_message_id, event_at desc);

create table public.email_outbox_runs (
  id uuid primary key default gen_random_uuid(),
  invocation_id text not null unique,
  trigger_type text not null default 'cron' check (trigger_type in ('cron', 'manual')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  processed_count integer not null default 0 check (processed_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  retrying_count integer not null default 0 check (retrying_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_code text,
  check (finished_at is null or finished_at >= started_at)
);

create index email_outbox_runs_started_idx on public.email_outbox_runs (started_at desc);

create trigger plans_set_updated_at before update on public.plans for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger workspace_members_set_updated_at before update on public.workspace_members for each row execute function public.set_updated_at();
create trigger workspace_invitations_set_updated_at before update on public.workspace_invitations for each row execute function public.set_updated_at();
create trigger workspace_subscriptions_set_updated_at before update on public.workspace_subscriptions for each row execute function public.set_updated_at();
create trigger workspace_usage_periods_set_updated_at before update on public.workspace_usage_periods for each row execute function public.set_updated_at();
create trigger billing_provider_prices_set_updated_at before update on public.billing_provider_prices for each row execute function public.set_updated_at();
create trigger billing_checkout_sessions_set_updated_at before update on public.billing_checkout_sessions for each row execute function public.set_updated_at();
create trigger billing_mutations_set_updated_at before update on public.billing_mutations for each row execute function public.set_updated_at();
create trigger workspace_domains_set_updated_at before update on public.workspace_domains for each row execute function public.set_updated_at();
create trigger workspace_pwa_settings_set_updated_at before update on public.workspace_pwa_settings for each row execute function public.set_updated_at();
create trigger workspace_push_subscriptions_set_updated_at before update on public.workspace_push_subscriptions for each row execute function public.set_updated_at();
create trigger subscription_overrides_set_updated_at before update on public.subscription_overrides for each row execute function public.set_updated_at();
create trigger platform_members_set_updated_at before update on public.platform_members for each row execute function public.set_updated_at();
create trigger platform_user_controls_set_updated_at before update on public.platform_user_controls for each row execute function public.set_updated_at();
create trigger platform_settings_set_updated_at before update on public.platform_settings for each row execute function public.set_updated_at();
create trigger email_delivery_events_set_updated_at before update on public.email_delivery_events for each row execute function public.set_updated_at();
create or replace function public.is_workspace_member(target_workspace_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members member
    join public.workspaces workspace on workspace.id = member.workspace_id
    where member.workspace_id = target_workspace_id and member.user_id = target_user_id
      and workspace.status = 'active' and workspace.platform_status = 'active'
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[], target_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members member
    join public.workspaces workspace on workspace.id = member.workspace_id
    where member.workspace_id = target_workspace_id and member.user_id = target_user_id
      and member.role = any(allowed_roles) and workspace.status = 'active' and workspace.platform_status = 'active'
  );
$$;

create or replace function public.is_platform_member(target_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.platform_members member
    left join public.platform_user_controls control on control.user_id = member.user_id
    where member.user_id = target_user_id and member.status = 'active'
      and coalesce(control.status, 'active') = 'active'
  );
$$;

create or replace function private.workspace_feature_enabled(target_workspace_id uuid, target_feature text)
returns boolean
language sql stable security definer set search_path = public, private
as $$
  select coalesce((plan.features ->> target_feature)::boolean, false)
  from public.workspace_subscriptions subscription
  join public.plans plan on plan.key = subscription.plan_key and plan.active
  where subscription.workspace_id = target_workspace_id;
$$;

create or replace function private.workspace_plan_limit(target_workspace_id uuid, target_metric text)
returns integer
language sql stable security definer set search_path = public, private
as $$
  select case
    when plan.limits ? target_metric and plan.limits ->> target_metric = 'null' then null
    when plan.limits ? target_metric then nullif(plan.limits ->> target_metric, '')::integer
    else null
  end
  from public.workspace_subscriptions subscription
  join public.plans plan on plan.key = subscription.plan_key and plan.active
  where subscription.workspace_id = target_workspace_id;
$$;

create or replace function private.core_default_plan_key()
returns text
language plpgsql stable security definer set search_path = public, private
as $$
declare
  configured_plan_key text;
begin
  select default_plan_key into configured_plan_key
  from private.core_settings
  where singleton;

  if configured_plan_key is null or not exists (
    select 1 from public.plans where key = configured_plan_key and active = true
  ) then
    raise exception using message = 'PLAN_NOT_CONFIGURED';
  end if;

  return configured_plan_key;
end;
$$;

create or replace function public.sync_core_catalog(
  target_plans jsonb,
  target_default_plan_key text,
  target_deactivate_missing boolean default false
)
returns table (synchronized_count integer, deactivated_count integer, configured_default_plan_key text)
language plpgsql security definer set search_path = public, private
as $$
declare
  plan_item jsonb;
  plan_position integer;
  synchronized integer := 0;
  deactivated integer := 0;
begin
  if target_plans is null or jsonb_typeof(target_plans) <> 'array' or jsonb_array_length(target_plans) = 0 then
    raise exception using message = 'CATALOG_INVALID';
  end if;

  if target_default_plan_key is null or target_default_plan_key !~ '^[a-z][a-z0-9_-]{0,63}$' then
    raise exception using message = 'DEFAULT_PLAN_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_plans) as entries(item)
    group by entries.item ->> 'key'
    having count(*) > 1
  ) then
    raise exception using message = 'CATALOG_INVALID';
  end if;

  for plan_item, plan_position in
    select entries.item, entries.ordinality::integer
    from jsonb_array_elements(target_plans) with ordinality as entries(item, ordinality)
  loop
    if plan_item ->> 'key' is null or plan_item ->> 'key' !~ '^[a-z][a-z0-9_-]{0,63}$'
      or nullif(btrim(plan_item ->> 'name'), '') is null
      or (plan_item ? 'active' and jsonb_typeof(plan_item -> 'active') <> 'boolean')
      or (plan_item ? 'features' and jsonb_typeof(plan_item -> 'features') <> 'object')
      or (plan_item ? 'limits' and jsonb_typeof(plan_item -> 'limits') <> 'object')
      or (plan_item ? 'metadata' and jsonb_typeof(plan_item -> 'metadata') <> 'object') then
      raise exception using message = 'CATALOG_INVALID';
    end if;

    insert into public.plans (key, name, sort_order, active, features, limits, metadata)
    values (
      plan_item ->> 'key',
      btrim(plan_item ->> 'name'),
      coalesce(nullif(plan_item ->> 'sort_order', '')::integer, plan_position - 1),
      coalesce((plan_item ->> 'active')::boolean, true),
      coalesce(plan_item -> 'features', '{}'::jsonb),
      coalesce(plan_item -> 'limits', '{}'::jsonb),
      coalesce(plan_item -> 'metadata', '{}'::jsonb)
    )
    on conflict (key) do update set
      name = excluded.name,
      sort_order = excluded.sort_order,
      active = excluded.active,
      features = excluded.features,
      limits = excluded.limits,
      metadata = excluded.metadata,
      updated_at = now();

    synchronized := synchronized + 1;
  end loop;

  if not exists (
    select 1
    from jsonb_array_elements(target_plans) as entries(item)
    where entries.item ->> 'key' = target_default_plan_key
      and coalesce((entries.item ->> 'active')::boolean, true)
  ) then
    raise exception using message = 'DEFAULT_PLAN_INVALID';
  end if;

  if target_deactivate_missing then
    update public.plans
    set active = false, updated_at = now()
    where key not in (
      select entries.item ->> 'key'
      from jsonb_array_elements(target_plans) as entries(item)
    )
      and active = true;
    get diagnostics deactivated = row_count;
  end if;

  insert into private.core_settings (singleton, default_plan_key)
  values (true, target_default_plan_key)
  on conflict (singleton) do update set
    default_plan_key = excluded.default_plan_key,
    updated_at = now();

  return query select synchronized, deactivated, target_default_plan_key;
end;
$$;

create or replace function public.get_core_schema_metadata()
returns table (schema_version text, runtime_major integer)
language plpgsql stable security definer set search_path = public, private
as $$
begin
  return query
  select metadata.schema_version, metadata.runtime_major
  from private.core_schema_metadata metadata
  where metadata.singleton;

  if not found then
    raise exception using message = 'CORE_SCHEMA_METADATA_MISSING';
  end if;
end;
$$;

create or replace function public.bootstrap_initial_workspace(target_workspace_name text, target_workspace_slug text default null)
returns table (workspace_id uuid, workspace_slug text)
language plpgsql security definer set search_path = public, private
as $$
declare
  actor uuid := auth.uid();
  workspace public.workspaces%rowtype;
  owner_count integer;
  workspace_limit integer;
  default_plan_key text;
  base_slug text := lower(trim(both '-' from regexp_replace(coalesce(nullif(btrim(target_workspace_slug), ''), target_workspace_name), '[^a-zA-Z0-9]+', '-', 'g')));
  candidate_slug text;
  suffix integer := 2;
begin
  if actor is null then raise exception using message = 'AUTH_REQUIRED'; end if;
  if length(btrim(coalesce(target_workspace_name, ''))) not between 1 and 120 then raise exception using message = 'INVALID_WORKSPACE_NAME'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select count(*)::integer into owner_count
    from public.workspace_members
    where user_id = actor and role = 'owner';
  default_plan_key := private.core_default_plan_key();
  select case
    when limits ? 'core.workspaces' and limits ->> 'core.workspaces' = 'null' then null
    when limits ? 'core.workspaces' then nullif(limits ->> 'core.workspaces', '')::integer
    else null
  end into workspace_limit
  from public.plans where key = default_plan_key;
  if workspace_limit is not null and owner_count >= workspace_limit then
    raise exception using message = 'WORKSPACE_LIMIT_REACHED';
  end if;
  if base_slug = '' then base_slug := 'workspace'; end if;
  if base_slug in ('www', 'app', 'api', 'admin', 'manage', 'login', 'signup', 'reset-password', 'onboarding', 'platform', 'assets', 'static') then raise exception using message = 'SLUG_RESERVED'; end if;
  candidate_slug := left(base_slug, 63);
  while exists (select 1 from public.workspaces where slug = candidate_slug) loop
    candidate_slug := left(base_slug, 58) || '-' || suffix::text;
    suffix := suffix + 1;
  end loop;
  insert into public.workspaces (name, slug, created_by) values (btrim(target_workspace_name), candidate_slug, actor) returning * into workspace;
  insert into public.workspace_members (workspace_id, user_id, role) values (workspace.id, actor, 'owner');
  return query select workspace.id, workspace.slug;
end;
$$;

create or replace function public.create_workspace_invitation(target_workspace_id uuid, target_email text, target_role text, target_token_hash text)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  invite public.workspace_invitations%rowtype;
begin
  if actor is null or not public.has_workspace_role(target_workspace_id, array['owner', 'admin'], actor) then raise exception using message = 'FORBIDDEN'; end if;
  if target_role not in ('admin', 'manager', 'staff', 'readonly') then raise exception using message = 'INVALID_ROLE'; end if;
  if length(btrim(target_email)) < 3 then raise exception using message = 'INVALID_EMAIL'; end if;
  insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at, invited_by)
  values (target_workspace_id, lower(btrim(target_email)), target_role, target_token_hash, now() + interval '7 days', actor)
  returning * into invite;
  return query select invite.id, invite.expires_at;
end;
$$;

create or replace function public.accept_workspace_invitation(target_token_hash text)
returns table (workspace_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  actor auth.users%rowtype;
  invite public.workspace_invitations%rowtype;
begin
  select * into actor from auth.users where id = auth.uid();
  if actor.id is null then raise exception using message = 'AUTH_REQUIRED'; end if;
  select * into invite from public.workspace_invitations where token_hash = target_token_hash for update;
  if invite.id is null then raise exception using message = 'EXPIRED'; end if;
  if invite.accepted_at is not null then raise exception using message = 'ALREADY_ACCEPTED'; end if;
  if invite.revoked_at is not null or invite.expires_at <= now() then raise exception using message = 'EXPIRED'; end if;
  if lower(coalesce(actor.email, '')) <> lower(invite.email) then raise exception using message = 'EMAIL_MISMATCH'; end if;
  if exists (select 1 from public.workspace_members existing_member where existing_member.workspace_id = invite.workspace_id and existing_member.user_id = actor.id) then
    update public.workspace_invitations set accepted_at = coalesce(accepted_at, now()) where id = invite.id;
    raise exception using message = 'ALREADY_MEMBER';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (invite.workspace_id, actor.id, invite.role);
  update public.workspace_invitations set accepted_at = now(), updated_at = now() where id = invite.id;
  return query select invite.workspace_id;
end;
$$;

create or replace function public.update_workspace_member(target_workspace_id uuid, target_member_id uuid, target_role text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_workspace_role(target_workspace_id, array['owner', 'admin']) then raise exception using message = 'FORBIDDEN'; end if;
  if target_role not in ('admin', 'manager', 'staff', 'readonly') then raise exception using message = 'INVALID_ROLE'; end if;
  update public.workspace_members set role = target_role where id = target_member_id and workspace_id = target_workspace_id and role <> 'owner';
  return found;
end;
$$;

create or replace function public.claim_email_delivery_event(target_event_id uuid, target_lease_token uuid)
returns table (claimed boolean, current_status text, payload jsonb, attempt_count integer, max_attempts integer)
language plpgsql security definer set search_path = public
as $$
declare
  event public.email_delivery_events%rowtype;
begin
  select * into event from public.email_delivery_events where id = target_event_id for update;
  if event.id is null then return query select false, 'not_found'::text, '{}'::jsonb, 0, 0; return; end if;
  if event.status in ('sent', 'delivered', 'bounced', 'paused') then return query select false, event.status, event.payload, event.attempt_count, event.max_attempts; return; end if;
  if event.lease_until is not null and event.lease_until > now() then return query select false, event.status, event.payload, event.attempt_count, event.max_attempts; return; end if;
  update public.email_delivery_events set status = 'sending', attempt_count = event.attempt_count + 1, lease_token = target_lease_token, lease_until = now() + interval '5 minutes', updated_at = now() where id = event.id;
  insert into public.email_delivery_attempts (delivery_event_id, attempt_number, status) values (event.id, event.attempt_count + 1, 'sending');
  return query select true, 'sending'::text, event.payload, event.attempt_count + 1, event.max_attempts;
end;
$$;

create or replace function public.apply_email_delivery_webhook(target_provider_event_id text, target_provider_message_id text, target_event_type text, target_event_at timestamptz, target_error text, target_pause_delivery boolean, target_payload jsonb)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  event public.email_delivery_events%rowtype;
  incoming_status text;
  current_rank integer;
  incoming_rank integer;
begin
  insert into public.email_provider_webhook_events (provider_event_id, provider_message_id, event_type, event_at, payload)
  values (target_provider_event_id, target_provider_message_id, target_event_type, target_event_at, coalesce(target_payload, '{}'::jsonb))
  on conflict (provider_event_id) do nothing;
  incoming_status := case target_event_type when 'email.delivered' then 'delivered' when 'email.bounced' then 'bounced' when 'email.failed' then 'failed' when 'email.complained' then 'failed' when 'email.suppressed' then 'failed' else null end;
  if incoming_status is null then return true; end if;
  select * into event from public.email_delivery_events where provider = 'resend' and provider_message_id = target_provider_message_id for update;
  if event.id is null then return true; end if;
  current_rank := case event.status when 'bounced' then 50 when 'failed' then 40 when 'delivered' then 30 when 'sent' then 20 else 10 end;
  incoming_rank := case incoming_status when 'bounced' then 50 when 'failed' then 40 when 'delivered' then 30 else 20 end;
  if incoming_rank >= current_rank then
    update public.email_delivery_events set status = incoming_status, delivered_at = case when incoming_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end, failed_at = case when incoming_status in ('failed', 'bounced') then coalesce(failed_at, now()) else failed_at end, last_error = case when incoming_status in ('failed', 'bounced') then left(coalesce(target_error, incoming_status), 2000) else last_error end, last_provider_event_at = coalesce(target_event_at, now()), updated_at = now(), metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_provider_event', target_event_type) where id = event.id;
  end if;
  if target_pause_delivery and incoming_status in ('failed', 'bounced') then
    update public.email_delivery_events set status = 'paused', updated_at = now() where id = event.id;
  end if;
  return true;
end;
$$;

create or replace function public.ensure_workspace_subscription()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  default_plan_key text;
begin
  default_plan_key := private.core_default_plan_key();
  insert into public.workspace_subscriptions (workspace_id, plan_key, status, source, current_period_start, current_period_end)
  values (new.id, default_plan_key, 'active', 'system', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month')::date)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

create trigger workspaces_create_subscription after insert on public.workspaces for each row execute function public.ensure_workspace_subscription();

insert into storage.buckets (id, name, public)
values ('workspace-assets', 'workspace-assets', true)
on conflict (id) do update set public = excluded.public;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.plans enable row level security;
alter table public.workspace_subscriptions enable row level security;
alter table public.workspace_usage_periods enable row level security;
alter table public.billing_provider_prices enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_checkout_sessions enable row level security;
alter table public.billing_mutations enable row level security;
alter table public.billing_cancellation_feedback enable row level security;
alter table public.workspace_domains enable row level security;
alter table public.workspace_pwa_settings enable row level security;
alter table public.workspace_push_subscriptions enable row level security;
alter table public.subscription_overrides enable row level security;
alter table public.platform_members enable row level security;
alter table public.platform_user_controls enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.platform_settings enable row level security;
alter table public.email_delivery_events enable row level security;
alter table public.email_delivery_attempts enable row level security;
alter table public.email_provider_webhook_events enable row level security;
alter table public.email_outbox_runs enable row level security;

create policy workspace_members_read on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy workspace_creator_insert on public.workspaces for insert to authenticated with check (created_by = (select auth.uid()));
create policy workspace_admin_update on public.workspaces for update to authenticated using (public.has_workspace_role(id, array['owner', 'admin'])) with check (public.has_workspace_role(id, array['owner', 'admin']));
create policy workspace_owner_delete on public.workspaces for delete to authenticated using (public.has_workspace_role(id, array['owner']));

create policy membership_read on public.workspace_members for select to authenticated using (user_id = (select auth.uid()) or public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy membership_manage on public.workspace_members for all to authenticated using (public.has_workspace_role(workspace_id, array['owner', 'admin'])) with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy invitations_read on public.workspace_invitations for select to authenticated using (public.has_workspace_role(workspace_id, array['owner', 'admin']) or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), '')));
create policy invitations_manage on public.workspace_invitations for all to authenticated using (public.has_workspace_role(workspace_id, array['owner', 'admin'])) with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy plans_read on public.plans for select to authenticated using (active = true);
create policy subscriptions_read on public.workspace_subscriptions for select to authenticated using (public.is_workspace_member(workspace_id));
create policy usage_read on public.workspace_usage_periods for select to authenticated using (public.is_workspace_member(workspace_id));
create policy domains_read on public.workspace_domains for select to authenticated using (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy domains_manage on public.workspace_domains for all to authenticated using (public.has_workspace_role(workspace_id, array['owner', 'admin'])) with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy pwa_read on public.workspace_pwa_settings for select to authenticated using (public.is_workspace_member(workspace_id));
create policy pwa_manage on public.workspace_pwa_settings for all to authenticated using (public.has_workspace_role(workspace_id, array['owner', 'admin']) and private.workspace_feature_enabled(workspace_id, 'customPWA')) with check (public.has_workspace_role(workspace_id, array['owner', 'admin']) and private.workspace_feature_enabled(workspace_id, 'customPWA'));
create policy push_read on public.workspace_push_subscriptions for select to authenticated using (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));
create policy push_manage on public.workspace_push_subscriptions for all to authenticated using (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id) and private.workspace_feature_enabled(workspace_id, 'pushNotifications')) with check (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id) and private.workspace_feature_enabled(workspace_id, 'pushNotifications'));

revoke all on public.billing_provider_prices, public.billing_webhook_events, public.billing_checkout_sessions, public.billing_mutations, public.billing_cancellation_feedback, public.subscription_overrides from anon, authenticated;
revoke all on public.platform_members, public.platform_user_controls, public.platform_audit_logs, public.platform_settings from anon, authenticated;
revoke all on public.email_delivery_events, public.email_delivery_attempts, public.email_provider_webhook_events, public.email_outbox_runs from anon, authenticated;
grant select, insert, update, delete on public.workspaces, public.workspace_members, public.workspace_invitations, public.workspace_domains, public.workspace_pwa_settings, public.workspace_push_subscriptions to authenticated;
grant select on public.plans, public.workspace_subscriptions, public.workspace_usage_periods to authenticated;
grant all on all tables in schema public to service_role;
grant execute on function public.bootstrap_initial_workspace(text, text) to authenticated;
grant execute on function public.create_workspace_invitation(uuid, text, text, text) to authenticated;
grant execute on function public.accept_workspace_invitation(text) to authenticated;
grant execute on function public.update_workspace_member(uuid, uuid, text) to authenticated;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, text[], uuid) to authenticated;
grant execute on function public.claim_email_delivery_event(uuid, uuid) to service_role;
grant execute on function public.apply_email_delivery_webhook(text, text, text, timestamptz, text, boolean, jsonb) to service_role;
grant execute on function private.workspace_feature_enabled(uuid, text) to authenticated;
revoke all on function private.core_default_plan_key() from public, anon, authenticated;
revoke all on function public.sync_core_catalog(jsonb, text, boolean), public.get_core_schema_metadata() from public, anon, authenticated;
grant execute on function public.sync_core_catalog(jsonb, text, boolean), public.get_core_schema_metadata() to service_role;

create policy workspace_assets_public_read on storage.objects for select using (bucket_id = 'workspace-assets');
create policy workspace_assets_member_insert on storage.objects for insert to authenticated with check (bucket_id = 'workspace-assets' and public.has_workspace_role((split_part(name, '/', 1))::uuid, array['owner', 'admin']));
create policy workspace_assets_member_update on storage.objects for update to authenticated using (bucket_id = 'workspace-assets' and public.has_workspace_role((split_part(name, '/', 1))::uuid, array['owner', 'admin'])) with check (bucket_id = 'workspace-assets' and public.has_workspace_role((split_part(name, '/', 1))::uuid, array['owner', 'admin']));
create policy workspace_assets_member_delete on storage.objects for delete to authenticated using (bucket_id = 'workspace-assets' and public.has_workspace_role((split_part(name, '/', 1))::uuid, array['owner', 'admin']));

comment on table public.workspaces is 'The Core tenancy boundary. Product domains attach to a workspace through their own workspace_id.';
comment on table public.workspace_members is 'Workspace membership and role enforcement for Core-managed access.';
comment on table public.email_delivery_events is 'Durable transactional email outbox. Payloads and recipients remain server-controlled.';
comment on table public.platform_audit_logs is 'Server-controlled audit trail for operator actions.';

notify pgrst, 'reload schema';
