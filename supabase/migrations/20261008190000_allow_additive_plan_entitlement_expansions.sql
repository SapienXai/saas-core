-- Referenced plan rows may receive a monotonic entitlement expansion. Prices,
-- metadata, identity and every prior entitlement remain protected.

create or replace function private.is_plan_entitlement_expansion(
  old_features jsonb,
  new_features jsonb,
  old_limits jsonb,
  new_limits jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  previous_features jsonb := coalesce(old_features, '{}'::jsonb);
  next_features jsonb := coalesce(new_features, '{}'::jsonb);
  previous_limits jsonb := coalesce(old_limits, '{}'::jsonb);
  next_limits jsonb := coalesce(new_limits, '{}'::jsonb);
  old_entry record;
  next_value jsonb;
  previous_number numeric;
  next_number numeric;
  has_expansion boolean := false;
begin
  if jsonb_typeof(previous_features) <> 'object'
     or jsonb_typeof(next_features) <> 'object'
     or jsonb_typeof(previous_limits) <> 'object'
     or jsonb_typeof(next_limits) <> 'object' then
    return false;
  end if;

  for old_entry in select entry.key, entry.value from jsonb_each(previous_features) as entry(key, value) loop
    if not (next_features ? old_entry.key) then
      return false;
    end if;
    next_value := next_features -> old_entry.key;
    if old_entry.value = next_value then
      continue;
    end if;
    if old_entry.value = 'false'::jsonb and next_value = 'true'::jsonb then
      has_expansion := true;
    else
      return false;
    end if;
  end loop;

  for old_entry in select entry.key, entry.value from jsonb_each(next_features) as entry(key, value) loop
    if not (previous_features ? old_entry.key) then
      if old_entry.value <> 'true'::jsonb then
        return false;
      end if;
      has_expansion := true;
    end if;
  end loop;

  for old_entry in select entry.key, entry.value from jsonb_each(previous_limits) as entry(key, value) loop
    if not (next_limits ? old_entry.key) then
      return false;
    end if;
    next_value := next_limits -> old_entry.key;
    if old_entry.value = next_value then
      continue;
    end if;
    if old_entry.value = 'null'::jsonb then
      return false;
    end if;
    if next_value = 'null'::jsonb then
      if jsonb_typeof(old_entry.value) <> 'number' then
        return false;
      end if;
      has_expansion := true;
      continue;
    end if;
    if jsonb_typeof(old_entry.value) <> 'number'
       or jsonb_typeof(next_value) <> 'number' then
      return false;
    end if;
    previous_number := (old_entry.value #>> '{}')::numeric;
    next_number := (next_value #>> '{}')::numeric;
    if next_number < previous_number then
      return false;
    end if;
    if next_number > previous_number then
      has_expansion := true;
    end if;
  end loop;

  for old_entry in select entry.key, entry.value from jsonb_each(next_limits) as entry(key, value) loop
    if not (previous_limits ? old_entry.key) then
      if old_entry.value = 'null'::jsonb then
        has_expansion := true;
        continue;
      end if;
      if jsonb_typeof(old_entry.value) <> 'number' then
        return false;
      end if;
      next_number := (old_entry.value #>> '{}')::numeric;
      if next_number <= 0 or next_number <> trunc(next_number) or next_number > 9007199254740991 then
        return false;
      end if;
      has_expansion := true;
    end if;
  end loop;

  return has_expansion;
end;
$$;

create or replace function private.guard_referenced_plan_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.key <> new.key then
    raise exception using message = 'PLAN_KEY_IMMUTABLE';
  end if;

  if old.active and not new.active and exists (
    select 1
      from public.workspace_subscriptions subscription
     where (subscription.plan_key = old.key or subscription.scheduled_plan_key = old.key)
       and subscription.status <> 'canceled'
  ) then
    raise exception using message = 'PLAN_REFERENCED_ACTIVE';
  end if;

  if (
    old.features is distinct from new.features
    or old.limits is distinct from new.limits
    or (old.metadata - 'recommended') is distinct from (new.metadata - 'recommended')
  ) and exists (
    select 1
      from public.workspace_subscriptions subscription
     where subscription.plan_key = old.key
        or subscription.scheduled_plan_key = old.key
  ) then
    if (old.metadata - 'recommended') is distinct from (new.metadata - 'recommended')
       or not private.is_plan_entitlement_expansion(old.features, new.features, old.limits, new.limits) then
      raise exception using message = 'PLAN_REFERENCED_IMMUTABLE';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.is_plan_entitlement_expansion(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.guard_referenced_plan_change() from public, anon, authenticated;

comment on function private.is_plan_entitlement_expansion(jsonb, jsonb, jsonb, jsonb) is
  'Returns true only when every existing feature/limit is preserved or expanded and at least one entitlement increases.';
comment on function private.guard_referenced_plan_change() is
  'Protects referenced plan prices, metadata and entitlement history while allowing monotonic entitlement expansions and presentation edits.';

notify pgrst, 'reload schema';
