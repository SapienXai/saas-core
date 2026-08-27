-- Reservevia forward migration 002: assign inherited Felix data.
-- The names below are the exact names in lib/seed-data.ts. This migration is
-- intentionally explicit so an unexpected production restaurant is never
-- silently classified as Felix data.

insert into public.workspaces (name, slug, status)
values ('Felix Restaurants', 'felix-restaurants', 'active')
on conflict (slug) do update
  set name = excluded.name,
      status = 'active',
      updated_at = now();

update public.restaurants as restaurant
set workspace_id = workspace.id
from public.workspaces as workspace
where workspace.slug = 'felix-restaurants'
  and lower(restaurant.name) in (
    'felix beach',
    'felix garden',
    'felix marina',
    'felix selimiye'
  )
  and restaurant.workspace_id is null;

do $$
begin
  if exists (select 1 from public.restaurants where workspace_id is null) then
    raise exception using
      message = 'Reservevia workspace backfill stopped: one or more restaurants were not assigned. Review restaurant names and assign them explicitly before rerunning 202608090002_backfill_felix_workspace.sql.';
  end if;
end $$;

-- Preserve existing admin_profiles access as an explicit compatibility bridge.
-- admin becomes owner; manager/staff/readonly retain their legacy role name.
insert into public.workspace_members (workspace_id, user_id, role)
select
  workspace.id,
  profile.id,
  case when profile.role = 'admin' then 'owner' else profile.role end
from public.admin_profiles as profile
cross join public.workspaces as workspace
where workspace.slug = 'felix-restaurants'
  and profile.role in ('admin', 'manager', 'staff', 'readonly')
  and (
    profile.restaurant_id is null
    or exists (
      select 1
      from public.restaurants as restaurant
      where restaurant.id = profile.restaurant_id
        and restaurant.workspace_id = workspace.id
    )
  )
on conflict (workspace_id, user_id) do update
  set role = excluded.role,
      updated_at = now();

do $$
begin
  if exists (
    select 1
    from public.restaurants as restaurant
    left join public.workspaces as workspace on workspace.id = restaurant.workspace_id
    where workspace.id is null
  ) then
    raise exception using message = 'Reservevia workspace backfill validation failed: a restaurant has no valid workspace owner.';
  end if;
end $$;

alter table public.restaurants
  alter column workspace_id set not null;

comment on table public.admin_profiles is 'Legacy profile metadata and compatibility source during migration. Workspace authorization is authoritative in workspace_members.';
