-- Keep one SELECT policy per table/action and split write policies by command.
-- This preserves the existing access predicates while avoiding overlapping
-- permissive policies on authenticated reads.

-- Notification settings
drop policy if exists "Workspace members can read notification settings" on public.notification_settings;
drop policy if exists "Workspace managers can manage notification settings" on public.notification_settings;

create policy "Workspace members can read notification settings"
  on public.notification_settings for select
  to authenticated
  using (public.can_access_restaurant(restaurant_id));

create policy "Workspace managers can create notification settings"
  on public.notification_settings for insert
  to authenticated
  with check (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin', 'manager']
    )
  );

create policy "Workspace managers can update notification settings"
  on public.notification_settings for update
  to authenticated
  using (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin', 'manager']
    )
  )
  with check (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin', 'manager']
    )
  );

create policy "Workspace managers can delete notification settings"
  on public.notification_settings for delete
  to authenticated
  using (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin', 'manager']
    )
  );

-- Reservation areas
drop policy if exists "Workspace members can read reservation areas" on public.reservation_areas;
drop policy if exists "Workspace managers can manage reservation areas" on public.reservation_areas;

create policy "Workspace members can read reservation areas"
  on public.reservation_areas for select
  to authenticated
  using (public.can_access_restaurant(restaurant_id));

create policy "Workspace managers can create reservation areas"
  on public.reservation_areas for insert
  to authenticated
  with check (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin', 'manager']
    )
  );

create policy "Workspace managers can update reservation areas"
  on public.reservation_areas for update
  to authenticated
  using (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin', 'manager']
    )
  )
  with check (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin', 'manager']
    )
  );

create policy "Workspace managers can delete reservation areas"
  on public.reservation_areas for delete
  to authenticated
  using (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin', 'manager']
    )
  );

-- Restaurant domains had two identical authenticated SELECT policies.
drop policy if exists "workspace members can view restaurant domains" on public.restaurant_domains;

-- Restaurant media
drop policy if exists "Workspace members can read restaurant media" on public.restaurant_media;
drop policy if exists "Workspace managers can manage restaurant media" on public.restaurant_media;

create policy "Workspace members can read restaurant media"
  on public.restaurant_media for select
  to authenticated
  using (public.can_access_restaurant(restaurant_id));

create policy "Workspace managers can create restaurant media"
  on public.restaurant_media for insert
  to authenticated
  with check (
    public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin']
    )
  );

create policy "Workspace managers can update restaurant media"
  on public.restaurant_media for update
  to authenticated
  using (
    public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin']
    )
  )
  with check (
    public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin']
    )
  );

create policy "Workspace managers can delete restaurant media"
  on public.restaurant_media for delete
  to authenticated
  using (
    public.has_workspace_role(
      (select workspace_id from public.restaurants where id = restaurant_id),
      array['owner', 'admin']
    )
  );

-- Workspace push subscriptions
drop policy if exists "Members can manage own workspace push subscriptions" on public.workspace_push_subscriptions;

create policy "Members can create own workspace push subscriptions"
  on public.workspace_push_subscriptions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_workspace_member(workspace_id)
    and private.workspace_feature_enabled(workspace_id, 'pushNotifications')
  );

create policy "Members can update own workspace push subscriptions"
  on public.workspace_push_subscriptions for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_workspace_member(workspace_id)
    and private.workspace_feature_enabled(workspace_id, 'pushNotifications')
  )
  with check (
    user_id = (select auth.uid())
    and public.is_workspace_member(workspace_id)
    and private.workspace_feature_enabled(workspace_id, 'pushNotifications')
  );

create policy "Members can delete own workspace push subscriptions"
  on public.workspace_push_subscriptions for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_workspace_member(workspace_id)
    and private.workspace_feature_enabled(workspace_id, 'pushNotifications')
  );

-- Workspace PWA settings
drop policy if exists "Owners and admins can manage PWA settings" on public.workspace_pwa_settings;

create policy "Owners and admins can create PWA settings"
  on public.workspace_pwa_settings for insert
  to authenticated
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    and private.workspace_feature_enabled(workspace_id, 'customPWA')
  );

create policy "Owners and admins can update PWA settings"
  on public.workspace_pwa_settings for update
  to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    and private.workspace_feature_enabled(workspace_id, 'customPWA')
  )
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    and private.workspace_feature_enabled(workspace_id, 'customPWA')
  );

create policy "Owners and admins can delete PWA settings"
  on public.workspace_pwa_settings for delete
  to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    and private.workspace_feature_enabled(workspace_id, 'customPWA')
  );
