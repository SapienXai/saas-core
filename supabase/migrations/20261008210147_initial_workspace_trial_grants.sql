begin;

-- A private-to-clients record of accounts created after this migration. The
-- product decides whether to grant a Workspace trial when its first resource
-- is provisioned; pre-existing Auth users are deliberately not backfilled.
alter table public.workspace_subscriptions
  add column initial_trial_started_at timestamptz,
  add column initial_trial_ends_at timestamptz,
  add constraint workspace_subscriptions_initial_trial_pair_check
    check ((initial_trial_started_at is null) = (initial_trial_ends_at is null)),
  add constraint workspace_subscriptions_initial_trial_order_check
    check (initial_trial_ends_at is null or initial_trial_ends_at > initial_trial_started_at);

alter table public.workspace_subscriptions
  drop constraint if exists workspace_subscriptions_source_check,
  add constraint workspace_subscriptions_source_check
    check (source in ('manual', 'system', 'paddle', 'provider', 'trial'));

create table public.workspace_initial_trial_eligibility (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signup_at timestamptz not null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  plan_key text references public.plans(key),
  duration_days integer check (duration_days between 1 and 90),
  started_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check ((workspace_id is null and plan_key is null and duration_days is null and started_at is null and ends_at is null)
      or (workspace_id is not null and plan_key is not null and duration_days is not null and started_at is not null and ends_at > started_at))
);

alter table public.workspace_initial_trial_eligibility enable row level security;
revoke all on table public.workspace_initial_trial_eligibility from public, anon, authenticated;
grant all on table public.workspace_initial_trial_eligibility to service_role;

create or replace function public.capture_workspace_initial_trial_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_initial_trial_eligibility (user_id, signup_at)
  values (new.id, coalesce(new.created_at, clock_timestamp()))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.capture_workspace_initial_trial_eligibility() from public, anon, authenticated;
drop trigger if exists auth_user_capture_workspace_initial_trial on auth.users;
create trigger auth_user_capture_workspace_initial_trial
  after insert on auth.users
  for each row execute function public.capture_workspace_initial_trial_eligibility();

create or replace function public.grant_initial_workspace_trial(
  target_user_id uuid,
  target_workspace_id uuid,
  target_plan_key text,
  target_duration_days integer
)
returns table (
  eligible boolean,
  granted boolean,
  plan_key text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  eligible_row public.workspace_initial_trial_eligibility%rowtype;
  workspace_row public.workspaces%rowtype;
  subscription_row public.workspace_subscriptions%rowtype;
  plan_is_paid boolean;
  grant_started_at timestamptz := clock_timestamp();
  grant_ends_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if target_user_id is null or target_workspace_id is null
     or target_plan_key is null or target_duration_days is null
     or target_duration_days not between 1 and 90 then
    raise exception 'INVALID_INITIAL_TRIAL_REQUEST' using errcode = '22023';
  end if;

  -- Serialize grants for an account, even when two setup requests reach
  -- different application instances at the same time.
  perform pg_advisory_xact_lock(hashtextextended('saas-core:initial-trial:' || target_user_id::text, 0));
  select eligible.* into eligible_row
    from public.workspace_initial_trial_eligibility eligible
   where eligible.user_id = target_user_id
   for update;
  if not found then
    return query select false, false, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if eligible_row.workspace_id is not null then
    if eligible_row.workspace_id <> target_workspace_id then
      raise exception 'INITIAL_TRIAL_ALREADY_CLAIMED' using errcode = '23505';
    end if;
    return query select true, true, eligible_row.plan_key, eligible_row.started_at, eligible_row.ends_at;
    return;
  end if;

  select workspace.* into workspace_row
    from public.workspaces workspace
    join public.workspace_members member
      on member.workspace_id = workspace.id
     and member.user_id = target_user_id
     and member.role = 'owner'
   where workspace.id = target_workspace_id
     and workspace.created_by = target_user_id
     and workspace.status = 'active'
     and workspace.platform_status = 'active';
  if not found then
    return query select false, false, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  select plan.active and (
           coalesce((plan.metadata #>> '{pricing,month,amount}')::numeric, 0) > 0
           or coalesce((plan.metadata #>> '{pricing,year,amount}')::numeric, 0) > 0
         )
    into plan_is_paid
    from public.plans plan
   where plan.key = target_plan_key;
  if plan_is_paid is not true then
    raise exception 'INITIAL_TRIAL_PLAN_UNAVAILABLE' using errcode = '23514';
  end if;

  select subscription.* into subscription_row
    from public.workspace_subscriptions subscription
   where subscription.workspace_id = target_workspace_id
   for update;
  if not found or subscription_row.source <> 'system' then
    return query select false, false, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  grant_ends_at := grant_started_at + make_interval(days => target_duration_days);
  update public.workspace_subscriptions
     set plan_key = target_plan_key,
         status = 'trialing',
         source = 'trial',
         current_period_start = grant_started_at::date,
         current_period_end = grant_ends_at::date,
         current_period_start_at = grant_started_at,
         current_period_end_at = grant_ends_at,
         cancel_at_period_end = false,
         provider = null,
         provider_environment = null,
         provider_customer_id = null,
         provider_subscription_id = null,
         provider_price_id = null,
         provider_status = null,
         billing_interval = null,
         billing_currency = null,
         scheduled_change_at = null,
         scheduled_change_action = null,
         scheduled_plan_key = null,
         scheduled_plan_at = null,
         scheduled_effective_at = null,
         scheduled_plan_interval = null,
         scheduled_provider_price_id = null,
         payment_failure_started_at = null,
         payment_grace_ends_at = null,
         billing_issue_code = null,
         initial_trial_started_at = grant_started_at,
         initial_trial_ends_at = grant_ends_at
   where workspace_id = target_workspace_id;

  update public.workspace_initial_trial_eligibility
     set workspace_id = target_workspace_id,
         plan_key = target_plan_key,
         duration_days = target_duration_days,
         started_at = grant_started_at,
         ends_at = grant_ends_at
   where user_id = target_user_id;

  return query select true, true, target_plan_key, grant_started_at, grant_ends_at;
end;
$$;

revoke all on function public.grant_initial_workspace_trial(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.grant_initial_workspace_trial(uuid, uuid, text, integer) to service_role;

comment on table public.workspace_initial_trial_eligibility is
  'One-use marker captured for Auth users created after trial rollout; service-role only.';
comment on column public.workspace_subscriptions.initial_trial_ends_at is
  'Original no-card Workspace trial boundary, retained after paid conversion to distinguish new trial cohorts from existing Free customers.';
comment on function public.grant_initial_workspace_trial(uuid, uuid, text, integer) is
  'Idempotently grants the application-configured first Workspace trial to an eligible new Auth user.';

commit;
