-- Reservevia forward migration 003: workspace-aware RLS.
-- Public booking/listing uses the server-only service-role client. Anonymous
-- direct table reads are removed so management fields are not globally exposed.

create or replace function public.is_workspace_member(
  target_workspace_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members membership
    join public.workspaces workspace on workspace.id = membership.workspace_id
    where membership.workspace_id = target_workspace_id
      and membership.user_id = target_user_id
      and workspace.status = 'active'
  );
$$;

create or replace function public.has_workspace_role(
  target_workspace_id uuid,
  allowed_roles text[],
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members membership
    join public.workspaces workspace on workspace.id = membership.workspace_id
    where membership.workspace_id = target_workspace_id
      and membership.user_id = target_user_id
      and membership.role = any(allowed_roles)
      and workspace.status = 'active'
  );
$$;

create or replace function public.can_access_restaurant(
  target_restaurant_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurants restaurant
    join public.workspace_members membership on membership.workspace_id = restaurant.workspace_id
    join public.workspaces workspace on workspace.id = membership.workspace_id
    where restaurant.id = target_restaurant_id
      and membership.user_id = target_user_id
      and workspace.status = 'active'
      and (
        membership.role in ('owner', 'admin', 'manager')
        or exists (
          select 1
          from public.admin_profiles profile
          where profile.id = target_user_id
            and profile.restaurant_id = target_restaurant_id
        )
      )
  );
$$;

create or replace function public.can_operate_restaurant(
  target_restaurant_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurants restaurant
    join public.workspace_members membership on membership.workspace_id = restaurant.workspace_id
    join public.workspaces workspace on workspace.id = membership.workspace_id
    where restaurant.id = target_restaurant_id
      and membership.user_id = target_user_id
      and workspace.status = 'active'
      and (
        membership.role in ('owner', 'admin', 'manager')
        or (
          membership.role = 'staff'
          and exists (
            select 1
            from public.admin_profiles profile
            where profile.id = target_user_id
              and profile.restaurant_id = target_restaurant_id
          )
        )
      )
  );
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_media enable row level security;
alter table public.notification_settings enable row level security;
alter table public.reservation_areas enable row level security;
alter table public.reservations enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.admin_push_subscriptions enable row level security;

drop policy if exists "Public read restaurants" on public.restaurants;
drop policy if exists "Public read media" on public.restaurant_media;
drop policy if exists "Public read reservation areas" on public.reservation_areas;
drop policy if exists "Manage own push subscriptions" on public.admin_push_subscriptions;

drop policy if exists "Workspace members can read workspaces" on public.workspaces;
create policy "Workspace members can read workspaces"
  on public.workspaces for select
  using (public.is_workspace_member(id));

drop policy if exists "Members can read workspace memberships" on public.workspace_members;
create policy "Members can read workspace memberships"
  on public.workspace_members for select
  using (
    user_id = auth.uid()
    or public.has_workspace_role(workspace_id, array['owner', 'admin'])
  );

drop policy if exists "Owners and admins can manage workspace memberships" on public.workspace_members;
create policy "Owners and admins can manage workspace memberships"
  on public.workspace_members for all
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists "Workspace members can read restaurants" on public.restaurants;
create policy "Workspace members can read restaurants"
  on public.restaurants for select
  using (public.can_access_restaurant(id));

drop policy if exists "Workspace managers can create restaurants" on public.restaurants;
create policy "Workspace managers can create restaurants"
  on public.restaurants for insert
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists "Workspace managers can update restaurants" on public.restaurants;
create policy "Workspace managers can update restaurants"
  on public.restaurants for update
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'manager']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'manager']));

drop policy if exists "Workspace owners can delete restaurants" on public.restaurants;
create policy "Workspace owners can delete restaurants"
  on public.restaurants for delete
  using (public.has_workspace_role(workspace_id, array['owner']));

drop policy if exists "Workspace members can read restaurant media" on public.restaurant_media;
create policy "Workspace members can read restaurant media"
  on public.restaurant_media for select
  using (public.can_access_restaurant(restaurant_id));

drop policy if exists "Workspace managers can manage restaurant media" on public.restaurant_media;
create policy "Workspace managers can manage restaurant media"
  on public.restaurant_media for all
  using (public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin']))
  with check (public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin']));

drop policy if exists "Workspace members can read notification settings" on public.notification_settings;
create policy "Workspace members can read notification settings"
  on public.notification_settings for select
  using (public.can_access_restaurant(restaurant_id));

drop policy if exists "Workspace managers can manage notification settings" on public.notification_settings;
create policy "Workspace managers can manage notification settings"
  on public.notification_settings for all
  using (public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager']))
  with check (public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager']));

drop policy if exists "Workspace members can read reservation areas" on public.reservation_areas;
create policy "Workspace members can read reservation areas"
  on public.reservation_areas for select
  using (public.can_access_restaurant(restaurant_id));

drop policy if exists "Workspace managers can manage reservation areas" on public.reservation_areas;
create policy "Workspace managers can manage reservation areas"
  on public.reservation_areas for all
  using (public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager']))
  with check (public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager']));

drop policy if exists "Workspace members can read reservations" on public.reservations;
create policy "Workspace members can read reservations"
  on public.reservations for select
  using (public.can_access_restaurant(restaurant_id));

drop policy if exists "Workspace staff can create reservations" on public.reservations;
create policy "Workspace staff can create reservations"
  on public.reservations for insert
  with check (public.can_operate_restaurant(restaurant_id));

drop policy if exists "Workspace staff can update reservations" on public.reservations;
create policy "Workspace staff can update reservations"
  on public.reservations for update
  using (public.can_operate_restaurant(restaurant_id))
  with check (public.can_operate_restaurant(restaurant_id));

drop policy if exists "Workspace managers can delete reservations" on public.reservations;
create policy "Workspace managers can delete reservations"
  on public.reservations for delete
  using (public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager']));

drop policy if exists "Users can read compatible profiles" on public.admin_profiles;
create policy "Users can read compatible profiles"
  on public.admin_profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.workspace_members membership
      where membership.user_id = admin_profiles.id
        and public.has_workspace_role(membership.workspace_id, array['owner', 'admin'])
    )
  );

drop policy if exists "Users can manage own push subscriptions" on public.admin_push_subscriptions;
create policy "Users can manage own push subscriptions"
  on public.admin_push_subscriptions for all
  using (auth.uid() = user_id and (restaurant_id is null or public.can_access_restaurant(restaurant_id)))
  with check (auth.uid() = user_id and (restaurant_id is null or public.can_access_restaurant(restaurant_id)));

comment on function public.can_access_restaurant(uuid, uuid) is 'RLS defense-in-depth for tenant reads: membership plus legacy staff restaurant assignment. Service-role application queries still perform explicit server-side authorization.';
comment on function public.can_operate_restaurant(uuid, uuid) is 'RLS defense-in-depth for tenant writes: readonly members cannot create or update reservations.';
