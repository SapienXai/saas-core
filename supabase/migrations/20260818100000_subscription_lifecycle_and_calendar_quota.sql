-- Reservevia subscription lifecycle and calendar-month reservation quota.
-- Paddle remains the financial authority; these fields make the local access
-- decision durable during payment recovery and provider retry windows.

alter table public.workspace_subscriptions
  add column if not exists payment_failure_started_at timestamptz,
  add column if not exists payment_grace_ends_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_subscriptions_payment_grace_check'
      and conrelid = 'public.workspace_subscriptions'::regclass
  ) then
    alter table public.workspace_subscriptions
      add constraint workspace_subscriptions_payment_grace_check
      check (
        (payment_failure_started_at is null and payment_grace_ends_at is null)
        or (
          payment_failure_started_at is not null
          and payment_grace_ends_at is not null
          and payment_grace_ends_at >= payment_failure_started_at
        )
      );
  end if;
end $$;

create index if not exists workspace_subscriptions_payment_grace_idx
  on public.workspace_subscriptions (payment_grace_ends_at)
  where payment_grace_ends_at is not null and plan_key <> 'free';

-- Give already-projected payment failures a bounded recovery window instead
-- of silently granting indefinite paid access after this migration lands.
update public.workspace_subscriptions
set payment_failure_started_at = coalesce(last_provider_event_at, updated_at, now()),
    payment_grace_ends_at = coalesce(last_provider_event_at, updated_at, now()) + interval '14 days',
    billing_issue_code = 'past_due'
where (status = 'past_due' or provider_status = 'past_due')
  and payment_failure_started_at is null
  and payment_grace_ends_at is null;

-- Earlier paid reservations may have been counted against a Paddle billing
-- period. Seed the current calendar bucket from the immutable reservation
-- records before the trigger starts using calendar buckets for every plan.
insert into public.workspace_usage_periods (
  workspace_id, period_start, period_end, reservations_created
)
select
  restaurant.workspace_id,
  private.calendar_period_start(current_date),
  private.calendar_period_end(current_date),
  count(reservation.id)::integer
from public.restaurants as restaurant
left join public.reservations as reservation
  on reservation.restaurant_id = restaurant.id
  and reservation.created_at >= date_trunc('month', now())
  and reservation.created_at < date_trunc('month', now()) + interval '1 month'
where restaurant.workspace_id is not null
group by restaurant.workspace_id
having count(reservation.id) > 0
on conflict (workspace_id, period_start, period_end) do update
set reservations_created = greatest(
      public.workspace_usage_periods.reservations_created,
      excluded.reservations_created
    ),
    updated_at = now();

-- All plan reservation limits are expressed per calendar month. The row lock
-- on the workspace subscription serializes quota checks with plan lifecycle
-- changes; the usage-row lock serializes concurrent reservation inserts.
create or replace function private.consume_reservation_quota()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  usage_start date;
  usage_end date;
  subscription_plan_key text := 'free';
  subscription_status text := 'active';
  payment_grace_ends_at timestamptz;
  reservation_limit integer;
  current_usage integer;
begin
  select restaurant.workspace_id
    into target_workspace_id
  from public.restaurants as restaurant
  where restaurant.id = new.restaurant_id;

  if target_workspace_id is null then
    raise exception using
      errcode = '23514',
      message = 'Reservation restaurant has no workspace owner.';
  end if;

  select
    subscription.plan_key,
    subscription.status,
    subscription.payment_grace_ends_at
  into subscription_plan_key, subscription_status, payment_grace_ends_at
  from public.workspace_subscriptions as subscription
  where subscription.workspace_id = target_workspace_id
  for update;

  -- A past-due subscription is paid during its grace period. After the
  -- projection expires, fail closed to Free even if the lifecycle worker has
  -- not run yet. The worker still persists the downgrade for the rest of the
  -- application and UI.
  if subscription_status = 'past_due'
    and payment_grace_ends_at is not null
    and payment_grace_ends_at <= now()
  then
    subscription_plan_key := 'free';
  end if;

  usage_start := private.calendar_period_start(current_date);
  usage_end := private.calendar_period_end(current_date);

  select plan.reservation_limit
    into reservation_limit
  from public.plans as plan
  where plan.key = coalesce(subscription_plan_key, 'free');

  if reservation_limit is null and not exists (
    select 1 from public.plans where key = coalesce(subscription_plan_key, 'free')
  ) then
    select free_plan.reservation_limit
      into reservation_limit
    from public.plans as free_plan
    where free_plan.key = 'free';
  end if;

  insert into public.workspace_usage_periods (
    workspace_id, period_start, period_end, reservations_created
  )
  values (target_workspace_id, usage_start, usage_end, 0)
  on conflict (workspace_id, period_start, period_end) do nothing;

  select usage.reservations_created
    into current_usage
  from public.workspace_usage_periods as usage
  where usage.workspace_id = target_workspace_id
    and usage.period_start = usage_start
    and usage.period_end = usage_end
  for update;

  if reservation_limit is not null and current_usage >= reservation_limit then
    raise exception using
      errcode = 'P0001',
      message = 'Monthly reservation limit reached.',
      detail = 'RESERVATION_LIMIT_REACHED';
  end if;

  update public.workspace_usage_periods
  set reservations_created = reservations_created + 1,
      updated_at = now()
  where workspace_id = target_workspace_id
    and period_start = usage_start
    and period_end = usage_end;

  return new;
end;
$$;

revoke all on function private.consume_reservation_quota() from public;
revoke all on function private.consume_reservation_quota() from anon;
revoke all on function private.consume_reservation_quota() from authenticated;

comment on function private.consume_reservation_quota() is
  'Atomic calendar-month reservation quota enforcement for every reservation entry point.';
