-- Protect the last active Platform Owner from accidental role/status changes.
-- User mutations still run through the server-side platform admin boundary;
-- these triggers provide database defense in depth for service-role tooling.

create or replace function public.prevent_platform_owner_lockout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  is_active_owner boolean;
  remaining_owners integer;
begin
  is_active_owner := old.role = 'platform_owner' and old.status = 'active';
  if tg_op = 'UPDATE' then
    is_active_owner := is_active_owner and (new.role <> 'platform_owner' or new.status <> 'active');
  end if;
  if not is_active_owner then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select count(*)::integer into remaining_owners
    from public.platform_members member
    left join public.platform_user_controls control on control.user_id = member.user_id
   where member.role = 'platform_owner'
     and member.status = 'active'
     and member.user_id <> old.user_id
     and coalesce(control.status, 'active') = 'active';
  if remaining_owners = 0 then
    raise exception 'PLATFORM_OWNER_LOCKOUT' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_platform_control_lockout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_without_control boolean;
  remaining_owners integer;
  target_user_id uuid;
begin
  target_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if tg_op <> 'DELETE' and new.status <> 'suspended' then return new; end if;
  owner_without_control := exists (
    select 1 from public.platform_members member
    where member.user_id = target_user_id
      and member.role = 'platform_owner'
      and member.status = 'active'
  );
  if not owner_without_control then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select count(*)::integer into remaining_owners
    from public.platform_members member
    left join public.platform_user_controls control on control.user_id = member.user_id
   where member.role = 'platform_owner'
     and member.status = 'active'
     and member.user_id <> target_user_id
     and coalesce(control.status, 'active') = 'active';
  if remaining_owners = 0 then raise exception 'PLATFORM_OWNER_LOCKOUT' using errcode = '23514'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists platform_members_owner_lockout on public.platform_members;
create trigger platform_members_owner_lockout
before update or delete on public.platform_members
for each row execute function public.prevent_platform_owner_lockout();

drop trigger if exists platform_user_controls_owner_lockout on public.platform_user_controls;
create trigger platform_user_controls_owner_lockout
before insert or update or delete on public.platform_user_controls
for each row execute function public.prevent_platform_control_lockout();

create index if not exists platform_members_role_status_idx on public.platform_members (role, status, created_at);
create index if not exists platform_user_controls_status_idx on public.platform_user_controls (status, updated_at);

revoke all on function public.prevent_platform_owner_lockout() from public, anon, authenticated;
revoke all on function public.prevent_platform_control_lockout() from public, anon, authenticated;

notify pgrst, 'reload schema';
