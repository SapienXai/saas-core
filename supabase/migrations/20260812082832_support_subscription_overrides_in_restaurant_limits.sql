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
  join public.plans as plan on plan.key = coalesce(effective_override.plan_key, subscription.plan_key)
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

comment on function private.enforce_workspace_restaurant_limit() is 'Concurrency-safe restaurant limit enforcement using the effective workspace plan override.';
