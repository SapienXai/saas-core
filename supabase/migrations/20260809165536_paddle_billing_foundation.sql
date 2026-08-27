-- Reservevia forward migration: Paddle Billing provider mappings, durable
-- webhook inbox, and server-controlled checkout/reconciliation state.
-- Paddle never becomes the application entitlement source of truth.

alter table public.workspace_subscriptions
  add column if not exists provider text,
  add column if not exists provider_environment text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_subscription_id text,
  add column if not exists provider_price_id text,
  add column if not exists provider_status text,
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists last_provider_event_id text,
  add column if not exists next_billed_at timestamptz,
  add column if not exists scheduled_change_at timestamptz,
  add column if not exists scheduled_change_action text,
  add column if not exists billing_issue_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_subscriptions_provider_check'
      and conrelid = 'public.workspace_subscriptions'::regclass
  ) then
    alter table public.workspace_subscriptions
      add constraint workspace_subscriptions_provider_check
      check (provider is null or provider = 'paddle');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_subscriptions_provider_environment_check'
      and conrelid = 'public.workspace_subscriptions'::regclass
  ) then
    alter table public.workspace_subscriptions
      add constraint workspace_subscriptions_provider_environment_check
      check (provider_environment is null or provider_environment in ('sandbox', 'live'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_subscriptions_scheduled_change_action_check'
      and conrelid = 'public.workspace_subscriptions'::regclass
  ) then
    alter table public.workspace_subscriptions
      add constraint workspace_subscriptions_scheduled_change_action_check
      check (scheduled_change_action is null or scheduled_change_action in ('cancel', 'pause', 'resume'));
  end if;
end $$;

create unique index if not exists workspace_subscriptions_provider_subscription_key
  on public.workspace_subscriptions (provider, provider_environment, provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists workspace_subscriptions_provider_customer_idx
  on public.workspace_subscriptions (provider, provider_environment, provider_customer_id)
  where provider_customer_id is not null;

create table if not exists public.billing_provider_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'paddle'),
  environment text not null check (environment in ('sandbox', 'live')),
  plan_key text not null references public.plans(key),
  provider_product_id text not null check (length(trim(provider_product_id)) > 0),
  provider_price_id text not null check (length(trim(provider_price_id)) > 0),
  billing_interval text not null default 'month' check (billing_interval = 'month'),
  currency text not null default 'USD' check (currency = 'USD'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_provider_prices_paid_plan_check check (plan_key in ('starter', 'pro', 'business')),
  constraint billing_provider_prices_provider_price_key unique (provider, environment, provider_price_id)
);

create unique index if not exists billing_provider_prices_active_plan_key
  on public.billing_provider_prices (provider, environment, plan_key, billing_interval, currency)
  where active = true;

create index if not exists billing_provider_prices_lookup_idx
  on public.billing_provider_prices (provider, environment, plan_key, active);

create trigger billing_provider_prices_set_updated_at
  before update on public.billing_provider_prices
  for each row execute function public.set_updated_at();

create table if not exists public.billing_webhook_events (
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
  constraint billing_webhook_events_provider_event_key unique (provider, provider_event_id)
);

create index if not exists billing_webhook_events_processing_idx
  on public.billing_webhook_events (provider, status, received_at);

create index if not exists billing_webhook_events_workspace_idx
  on public.billing_webhook_events (workspace_id, occurred_at desc);

create table if not exists public.billing_checkout_sessions (
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
  constraint billing_checkout_sessions_paid_plan_check check (target_plan_key in ('starter', 'pro', 'business')),
  constraint billing_checkout_sessions_idempotency_key unique (provider, environment, idempotency_key),
  constraint billing_checkout_sessions_transaction_key unique (provider, environment, provider_transaction_id)
);

create index if not exists billing_checkout_sessions_workspace_idx
  on public.billing_checkout_sessions (workspace_id, created_at desc);

create trigger billing_checkout_sessions_set_updated_at
  before update on public.billing_checkout_sessions
  for each row execute function public.set_updated_at();

alter table public.billing_provider_prices enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_checkout_sessions enable row level security;

-- Provider mappings, webhook state, and checkout state are server-controlled.
-- No normal browser role receives access to these tables.
revoke all on public.billing_provider_prices from anon, authenticated;
revoke all on public.billing_webhook_events from anon, authenticated;
revoke all on public.billing_checkout_sessions from anon, authenticated;

comment on table public.billing_provider_prices is 'Environment-specific Paddle product/price mapping. Server-controlled; Free has no mapping.';
comment on table public.billing_webhook_events is 'Minimal durable Paddle webhook inbox. Payloads are normalized and intentionally exclude raw payment details.';
comment on table public.billing_checkout_sessions is 'Server-created checkout requests used for workspace/idempotency tracking; never a source of paid entitlements.';
comment on column public.workspace_subscriptions.plan_key is 'Reservevia entitlement plan. Paddle price identity is resolved through billing_provider_prices.';
comment on column public.workspace_subscriptions.last_provider_event_at is 'Latest Paddle event timestamp applied; older events cannot overwrite local state.';

-- PostgREST needs to refresh its schema cache after the additive subscription
-- columns are introduced so server-side REST clients can use them immediately
-- after a clean local reset or a hosted migration.
notify pgrst, 'reload schema';
