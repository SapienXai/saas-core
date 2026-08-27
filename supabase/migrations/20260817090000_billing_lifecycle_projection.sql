-- Reservevia billing lifecycle projection.
-- Paddle remains the financial source of truth. These fields make the
-- provider state safe and fast to present and enforce locally.

alter table public.workspace_subscriptions
  add column if not exists billing_interval text,
  add column if not exists billing_currency text,
  add column if not exists current_period_start_at timestamptz,
  add column if not exists current_period_end_at timestamptz,
  add column if not exists scheduled_effective_at timestamptz,
  add column if not exists scheduled_plan_interval text,
  add column if not exists scheduled_provider_price_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_subscriptions_billing_interval_check'
      and conrelid = 'public.workspace_subscriptions'::regclass
  ) then
    alter table public.workspace_subscriptions
      add constraint workspace_subscriptions_billing_interval_check
      check (billing_interval is null or billing_interval in ('month', 'year'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_subscriptions_scheduled_plan_interval_check'
      and conrelid = 'public.workspace_subscriptions'::regclass
  ) then
    alter table public.workspace_subscriptions
      add constraint workspace_subscriptions_scheduled_plan_interval_check
      check (scheduled_plan_interval is null or scheduled_plan_interval in ('month', 'year'));
  end if;

  -- Replace an early version of this constraint if a partially executed
  -- dashboard run left it behind. Existing scheduled downgrades predate the
  -- provider-price projection, so they must remain valid without that field.
  alter table public.workspace_subscriptions
    drop constraint if exists workspace_subscriptions_scheduled_plan_provider_check;

  alter table public.workspace_subscriptions
    add constraint workspace_subscriptions_scheduled_plan_provider_check
    check (scheduled_plan_key is not null or scheduled_provider_price_id is null);
end $$;

update public.workspace_subscriptions
set current_period_start_at = current_period_start::timestamptz,
    current_period_end_at = current_period_end::timestamptz,
    scheduled_effective_at = scheduled_plan_at::timestamptz
where current_period_start_at is null
   or current_period_end_at is null
   or (scheduled_plan_at is not null and scheduled_effective_at is null);

alter table public.billing_provider_prices
  drop constraint if exists billing_provider_prices_billing_interval_check,
  drop constraint if exists billing_provider_prices_currency_check;

alter table public.billing_provider_prices
  add constraint billing_provider_prices_billing_interval_check
    check (billing_interval in ('month', 'year')),
  add constraint billing_provider_prices_currency_check
    check (currency ~ '^[A-Z]{3}$');

create index if not exists workspace_subscriptions_scheduled_effective_idx
  on public.workspace_subscriptions (scheduled_effective_at)
  where scheduled_effective_at is not null;

create table if not exists public.billing_mutations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_key text not null,
  operation text not null,
  fingerprint text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_mutations_request_key_check check (length(trim(request_key)) between 16 and 100),
  constraint billing_mutations_operation_check check (operation in (
    'checkout', 'plan_change', 'cancel', 'resume', 'payment_recovery'
  )),
  constraint billing_mutations_request_key_unique unique (workspace_id, request_key)
);

create unique index if not exists billing_mutations_one_pending_workspace
  on public.billing_mutations (workspace_id)
  where status in ('pending', 'unknown');

create index if not exists billing_mutations_workspace_created_idx
  on public.billing_mutations (workspace_id, created_at desc);

create trigger billing_mutations_set_updated_at
  before update on public.billing_mutations
  for each row execute function public.set_updated_at();

create table if not exists public.billing_cancellation_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_subscription_id text,
  reason_code text not null,
  feedback text,
  created_at timestamptz not null default now(),
  constraint billing_cancellation_feedback_reason_check check (reason_code in (
    'too_expensive', 'not_using', 'seasonal', 'missing_feature',
    'technical_problem', 'switching_solution', 'other'
  )),
  constraint billing_cancellation_feedback_length_check check (feedback is null or length(feedback) <= 1000)
);

create index if not exists billing_cancellation_feedback_workspace_idx
  on public.billing_cancellation_feedback (workspace_id, created_at desc);

alter table public.billing_mutations enable row level security;
alter table public.billing_cancellation_feedback enable row level security;

revoke all on table public.billing_mutations from anon, authenticated;
revoke all on table public.billing_cancellation_feedback from anon, authenticated;
grant all on table public.billing_mutations to service_role;
grant all on table public.billing_cancellation_feedback to service_role;
