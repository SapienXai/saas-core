-- Keep the current entitlement plan active until a scheduled downgrade reaches
-- the end of the current billing period. Paddle state and local access state
-- are intentionally represented separately.

alter table public.workspace_subscriptions
  add column if not exists scheduled_plan_key text references public.plans(key),
  add column if not exists scheduled_plan_at date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_subscriptions_scheduled_plan_check'
      and conrelid = 'public.workspace_subscriptions'::regclass
  ) then
    alter table public.workspace_subscriptions
      add constraint workspace_subscriptions_scheduled_plan_check
      check (
        (scheduled_plan_key is null and scheduled_plan_at is null)
        or (scheduled_plan_key is not null and scheduled_plan_at is not null)
      );
  end if;
end $$;

create index if not exists workspace_subscriptions_scheduled_plan_idx
  on public.workspace_subscriptions (scheduled_plan_key, scheduled_plan_at)
  where scheduled_plan_key is not null;

comment on column public.workspace_subscriptions.scheduled_plan_key is 'Plan that becomes the local entitlement plan at scheduled_plan_at.';
comment on column public.workspace_subscriptions.scheduled_plan_at is 'Date on which the scheduled entitlement plan becomes effective.';

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
  left join lateral (
    select override.plan_key
    from public.subscription_overrides as override
    where override.workspace_id = subscription.workspace_id
      and override.revoked_at is null
      and override.effective_from <= now()
      and (override.effective_until is null or override.effective_until > now())
    order by override.effective_from desc
    limit 1
  ) as effective_override on true
  left join lateral (
    select subscription.scheduled_plan_key as plan_key
    where subscription.scheduled_plan_at <= current_date
  ) as effective_scheduled on true
  join public.plans as plan on plan.key = coalesce(effective_override.plan_key, effective_scheduled.plan_key, subscription.plan_key)
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
