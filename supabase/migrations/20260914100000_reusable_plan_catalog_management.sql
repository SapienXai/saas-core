-- Reusable plan catalog management.
--
-- Plan keys remain stable foreign-key targets. Plan rows are archived rather
-- than deleted so subscription history remains readable. Once a plan has
-- been referenced, its entitlement maps and commercial metadata are frozen;
-- presentation fields can still be corrected by an authorized operator.

alter table public.plans
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'plans_description_length_check'
       and conrelid = 'public.plans'::regclass
  ) then
    alter table public.plans
      add constraint plans_description_length_check
      check (description is null or length(btrim(description)) between 1 and 1000);
  end if;
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
    raise exception using message = 'PLAN_REFERENCED_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists plans_guard_referenced_change on public.plans;
create trigger plans_guard_referenced_change
before update on public.plans
for each row execute function private.guard_referenced_plan_change();

revoke all on function private.guard_referenced_plan_change() from public, anon, authenticated;

comment on column public.plans.description is
  'Optional product-owned presentation copy; entitlement maps remain in features and limits.';

comment on function private.guard_referenced_plan_change() is
  'Preserves stable plan identity and historical entitlement meaning while allowing safe presentation edits.';

notify pgrst, 'reload schema';
