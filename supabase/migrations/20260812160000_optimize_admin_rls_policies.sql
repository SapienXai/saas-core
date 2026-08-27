-- Avoid repeated auth lookups and overlapping permissive policies on the
-- compatibility tables that are touched by authenticated management flows.

drop policy if exists "Read own admin profile" on public.admin_profiles;
drop policy if exists "Users can read compatible profiles" on public.admin_profiles;

create policy "Users can read compatible profiles"
  on public.admin_profiles for select
  using (
    (select auth.uid()) = id
    or exists (
      select 1
      from public.workspace_members as membership
      where membership.user_id = admin_profiles.id
        and public.has_workspace_role(membership.workspace_id, array['owner', 'admin'])
    )
  );

drop policy if exists "Read own push subscriptions" on public.admin_push_subscriptions;
drop policy if exists "Users can manage own push subscriptions" on public.admin_push_subscriptions;
drop policy if exists "Users can create own push subscriptions" on public.admin_push_subscriptions;
drop policy if exists "Users can update own push subscriptions" on public.admin_push_subscriptions;
drop policy if exists "Users can delete own push subscriptions" on public.admin_push_subscriptions;

create policy "Read own push subscriptions"
  on public.admin_push_subscriptions for select
  using ((select auth.uid()) = user_id);

create policy "Users can create own push subscriptions"
  on public.admin_push_subscriptions for insert
  with check (
    (select auth.uid()) = user_id
    and (restaurant_id is null or public.can_access_restaurant(restaurant_id))
  );

create policy "Users can update own push subscriptions"
  on public.admin_push_subscriptions for update
  using (
    (select auth.uid()) = user_id
    and (restaurant_id is null or public.can_access_restaurant(restaurant_id))
  )
  with check (
    (select auth.uid()) = user_id
    and (restaurant_id is null or public.can_access_restaurant(restaurant_id))
  );

create policy "Users can delete own push subscriptions"
  on public.admin_push_subscriptions for delete
  using (
    (select auth.uid()) = user_id
    and (restaurant_id is null or public.can_access_restaurant(restaurant_id))
  );
