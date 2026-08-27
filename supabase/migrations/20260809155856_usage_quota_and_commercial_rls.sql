-- Reservevia forward migration: atomic reservation usage enforcement and RLS
-- for commercial state. The quota trigger is the only write path for usage
-- counters available to normal application clients.

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
  subscription_plan_key text;
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

  -- Resolve the subscription first. A fallback plan must not be allowed to
  -- compete with the workspace's actual plan in a left join.
  select
    subscription.current_period_start,
    subscription.current_period_end,
    subscription.plan_key
  into usage_start, usage_end, subscription_plan_key
  from public.workspace_subscriptions as subscription
  where subscription.workspace_id = target_workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled')
  limit 1;

  if usage_start is null
    or usage_end is null
    or current_date < usage_start
    or current_date >= usage_end
  then
    usage_start := private.calendar_period_start(current_date);
    usage_end := private.calendar_period_end(current_date);
  end if;

  select plan.reservation_limit
    into reservation_limit
  from public.plans as plan
  where plan.key = coalesce(subscription_plan_key, 'free');

  -- The unique key plus the row lock make the check and increment one
  -- serialized operation. Any later reservation error rolls this update back
  -- with the insert; status changes never call this function.
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

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'reservations_consume_workspace_quota') then
    create trigger reservations_consume_workspace_quota
      before insert on public.reservations
      for each row execute function private.consume_reservation_quota();
  end if;
end $$;

alter table public.plans enable row level security;
alter table public.workspace_subscriptions enable row level security;
alter table public.workspace_usage_periods enable row level security;

drop policy if exists "Active plans are publicly readable" on public.plans;
create policy "Active plans are publicly readable"
  on public.plans
  for select
  to anon, authenticated
  using (active = true);

drop policy if exists "Members can read workspace subscription" on public.workspace_subscriptions;
create policy "Members can read workspace subscription"
  on public.workspace_subscriptions
  for select
  to authenticated
  using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "Members can read workspace usage" on public.workspace_usage_periods;
create policy "Members can read workspace usage"
  on public.workspace_usage_periods
  for select
  to authenticated
  using ((select public.is_workspace_member(workspace_id)));

revoke all on public.plans from anon, authenticated;
grant select on public.plans to anon, authenticated;

revoke all on public.workspace_subscriptions from anon, authenticated;
grant select on public.workspace_subscriptions to authenticated;

revoke all on public.workspace_usage_periods from anon, authenticated;
grant select on public.workspace_usage_periods to authenticated;

comment on function private.consume_reservation_quota() is 'Atomic workspace reservation quota enforcement. Called only by the reservations INSERT trigger.';

create or replace function private.enforce_workspace_restaurant_limit()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  restaurant_limit integer;
  restaurant_count integer;
begin
  if new.workspace_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.workspace_id is distinct from new.workspace_id then
    raise exception using
      errcode = 'P0001',
      message = 'Restaurant workspace ownership cannot be changed.';
  end if;

  perform 1
  from public.workspace_subscriptions
  where workspace_id = new.workspace_id
  for update;

  select plan.restaurant_limit
    into restaurant_limit
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key
  where subscription.workspace_id = new.workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');

  if restaurant_limit is null then
    select free_plan.restaurant_limit into restaurant_limit
    from public.plans as free_plan
    where free_plan.key = 'free';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into restaurant_count
    from public.restaurants
    where workspace_id = new.workspace_id;
  else
    select count(*) into restaurant_count
    from public.restaurants
    where workspace_id = new.workspace_id
      and id <> new.id;
  end if;

  if restaurant_limit is not null and restaurant_count >= restaurant_limit then
    raise exception using
      errcode = 'P0001',
      message = 'Restaurant limit reached for the current plan.',
      detail = 'RESTAURANT_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_workspace_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  user_limit integer;
  member_count integer;
begin
  perform 1
  from public.workspace_subscriptions
  where workspace_id = new.workspace_id
  for update;

  select plan.user_limit
    into user_limit
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key
  where subscription.workspace_id = new.workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');

  if user_limit is null then
    select free_plan.user_limit into user_limit
    from public.plans as free_plan
    where free_plan.key = 'free';
  end if;

  select count(*) into member_count
  from public.workspace_members
  where workspace_id = new.workspace_id;

  if user_limit is not null and member_count >= user_limit then
    raise exception using
      errcode = 'P0001',
      message = 'User limit reached for the current plan.',
      detail = 'USER_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_workspace_restaurant_limit() from public, anon, authenticated;
revoke all on function private.enforce_workspace_member_limit() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'restaurants_enforce_workspace_limit') then
    create trigger restaurants_enforce_workspace_limit
      before insert or update of workspace_id on public.restaurants
      for each row execute function private.enforce_workspace_restaurant_limit();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'workspace_members_enforce_user_limit') then
    create trigger workspace_members_enforce_user_limit
      before insert on public.workspace_members
      for each row execute function private.enforce_workspace_member_limit();
  end if;
end $$;

comment on function private.enforce_workspace_restaurant_limit() is 'Concurrency-safe protection for new restaurant ownership rows. Existing grandfathered rows remain intact.';
comment on function private.enforce_workspace_member_limit() is 'Concurrency-safe protection for new workspace membership rows.';
