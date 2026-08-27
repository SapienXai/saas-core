-- Reservevia forward migration: commercial catalog, workspace subscription
-- state, and period usage storage. The database is the source of truth for
-- numeric limits and feature capabilities; TypeScript only provides keys and
-- typed accessors.

create table if not exists public.plans (
  key text primary key,
  name text not null,
  monthly_price_usd_cents integer not null check (monthly_price_usd_cents >= 0),
  sort_order integer not null check (sort_order >= 0),
  active boolean not null default true,
  restaurant_limit integer not null check (restaurant_limit > 0),
  user_limit integer not null check (user_limit > 0),
  reservation_limit integer check (reservation_limit is null or reservation_limit > 0),
  history_days integer check (history_days is null or history_days > 0),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_key_check check (key in ('free', 'starter', 'pro', 'business'))
);

create index if not exists plans_active_sort_idx on public.plans (active, sort_order);

create table if not exists public.workspace_subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_key text not null references public.plans(key),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'paused')),
  source text not null default 'system' check (source in ('free', 'manual', 'system', 'paddle')),
  current_period_start date,
  current_period_end date,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_subscriptions_period_check check (
    (current_period_start is null and current_period_end is null)
    or (current_period_start is not null and current_period_end is not null and current_period_end > current_period_start)
  )
);

create table if not exists public.workspace_usage_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  reservations_created integer not null default 0 check (reservations_created >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_usage_period_range_check check (period_end > period_start),
  constraint workspace_usage_period_unique unique (workspace_id, period_start, period_end)
);

create index if not exists workspace_subscriptions_plan_idx on public.workspace_subscriptions (plan_key);
create index if not exists workspace_usage_periods_workspace_period_idx
  on public.workspace_usage_periods (workspace_id, period_start desc, period_end desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'plans_set_updated_at') then
    create trigger plans_set_updated_at
      before update on public.plans
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'workspace_subscriptions_set_updated_at') then
    create trigger workspace_subscriptions_set_updated_at
      before update on public.workspace_subscriptions
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'workspace_usage_periods_set_updated_at') then
    create trigger workspace_usage_periods_set_updated_at
      before update on public.workspace_usage_periods
      for each row execute function public.set_updated_at();
  end if;
end $$;

insert into public.plans (
  key, name, monthly_price_usd_cents, sort_order, active,
  restaurant_limit, user_limit, reservation_limit, history_days, features
)
values
  (
    'free', 'Free', 0, 10, true,
    1, 1, 100, 30,
    '{"hostedRestaurantPage":true,"emailNotifications":true,"removeReserveviaBranding":false,"customDomain":false,"basicAnalytics":true,"csvExport":false,"guestHistory":false,"automatedNotifications":false,"advancedReports":false,"customPWA":false,"pushNotifications":false,"multiRestaurant":false}'::jsonb
  ),
  (
    'starter', 'Starter', 1900, 20, true,
    1, 3, 500, 365,
    '{"hostedRestaurantPage":true,"emailNotifications":true,"removeReserveviaBranding":true,"customDomain":true,"basicAnalytics":true,"csvExport":true,"guestHistory":false,"automatedNotifications":false,"advancedReports":false,"customPWA":false,"pushNotifications":false,"multiRestaurant":false}'::jsonb
  ),
  (
    'pro', 'Pro', 4900, 30, true,
    1, 10, null, null,
    '{"hostedRestaurantPage":true,"emailNotifications":true,"removeReserveviaBranding":true,"customDomain":true,"basicAnalytics":true,"csvExport":true,"guestHistory":true,"automatedNotifications":true,"advancedReports":true,"customPWA":true,"pushNotifications":true,"multiRestaurant":false}'::jsonb
  ),
  (
    'business', 'Business', 9900, 40, true,
    3, 20, null, null,
    '{"hostedRestaurantPage":true,"emailNotifications":true,"removeReserveviaBranding":true,"customDomain":true,"basicAnalytics":true,"csvExport":true,"guestHistory":true,"automatedNotifications":true,"advancedReports":true,"customPWA":true,"pushNotifications":true,"multiRestaurant":true}'::jsonb
  )
on conflict (key) do update set
  name = excluded.name,
  monthly_price_usd_cents = excluded.monthly_price_usd_cents,
  sort_order = excluded.sort_order,
  active = excluded.active,
  restaurant_limit = excluded.restaurant_limit,
  user_limit = excluded.user_limit,
  reservation_limit = excluded.reservation_limit,
  history_days = excluded.history_days,
  features = excluded.features,
  updated_at = now();

create schema if not exists private;

create or replace function private.calendar_period_start(target_date date default current_date)
returns date
language sql
immutable
as $$
  select date_trunc('month', target_date::timestamp)::date;
$$;

create or replace function private.calendar_period_end(target_date date default current_date)
returns date
language sql
immutable
as $$
  select (date_trunc('month', target_date::timestamp) + interval '1 month')::date;
$$;

create or replace function private.assign_default_workspace_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.workspace_subscriptions (
    workspace_id, plan_key, status, source, current_period_start, current_period_end
  )
  values (
    new.id, 'free', 'active', 'free',
    private.calendar_period_start(current_date),
    private.calendar_period_end(current_date)
  )
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function private.assign_default_workspace_subscription() from public;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'workspaces_assign_default_subscription') then
    create trigger workspaces_assign_default_subscription
      after insert on public.workspaces
      for each row execute function private.assign_default_workspace_subscription();
  end if;
end $$;

insert into public.workspace_subscriptions (
  workspace_id, plan_key, status, source, current_period_start, current_period_end
)
select
  workspace.id,
  case when workspace.slug = 'felix-restaurants' then 'business' else 'free' end,
  'active',
  case when workspace.slug = 'felix-restaurants' then 'system' else 'free' end,
  private.calendar_period_start(current_date),
  private.calendar_period_end(current_date)
from public.workspaces as workspace
on conflict (workspace_id) do update set
  plan_key = case when excluded.workspace_id = (select id from public.workspaces where slug = 'felix-restaurants') then 'business' else public.workspace_subscriptions.plan_key end,
  source = case when excluded.workspace_id = (select id from public.workspaces where slug = 'felix-restaurants') then 'system' else public.workspace_subscriptions.source end,
  status = 'active',
  updated_at = now();

comment on table public.plans is 'Reservevia commercial catalog. Numeric limits and feature capabilities are database-owned.';
comment on table public.workspace_subscriptions is 'Current workspace commercial state. Paddle will synchronize this table in a later phase.';
comment on table public.workspace_usage_periods is 'Immutable-period usage counters. Reservation creation increments these atomically.';
comment on column public.workspace_usage_periods.reservations_created is 'Successful reservation inserts only; cancellation and deletion never decrement this value.';
