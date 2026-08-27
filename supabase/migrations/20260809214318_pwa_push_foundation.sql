-- Reservevia Phase 8: workspace-branded management PWA and workspace-aware
-- device push subscriptions.
--
-- The management PWA belongs to a workspace, not a restaurant. Push access is
-- derived from workspace membership plus restaurant scope at delivery time;
-- restaurant assignments are intentionally not copied onto device rows.

create table if not exists public.workspace_pwa_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  app_name text,
  icon_url text,
  theme_color text not null default '#1e40af',
  background_color text not null default '#ffffff',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_pwa_settings_app_name_check
    check (app_name is null or length(btrim(app_name)) between 1 and 60),
  constraint workspace_pwa_settings_theme_color_check
    check (theme_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint workspace_pwa_settings_background_color_check
    check (background_color ~ '^#[0-9a-fA-F]{6}$')
);

create trigger workspace_pwa_settings_set_updated_at
  before update on public.workspace_pwa_settings
  for each row execute function public.set_updated_at();

create table if not exists public.workspace_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, endpoint)
);

create index if not exists workspace_push_subscriptions_workspace_status_idx
  on public.workspace_push_subscriptions (workspace_id, status, user_id);

create index if not exists workspace_push_subscriptions_user_status_idx
  on public.workspace_push_subscriptions (user_id, status);

create trigger workspace_push_subscriptions_set_updated_at
  before update on public.workspace_push_subscriptions
  for each row execute function public.set_updated_at();

comment on table public.workspace_pwa_settings is 'Workspace-level management PWA branding. Public-safe fields only.';
comment on table public.workspace_push_subscriptions is 'Authenticated user/device Web Push subscriptions scoped to a workspace.';
comment on column public.workspace_push_subscriptions.endpoint is 'Web Push endpoint; treated as sensitive capability data and never shown in UI.';

create or replace function private.workspace_feature_enabled(
  target_workspace_id uuid,
  target_feature text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((plan.features ->> target_feature)::boolean, false)
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key and plan.active = true
  where subscription.workspace_id = target_workspace_id
  limit 1;
$$;

revoke all on function private.workspace_feature_enabled(uuid, text) from public, anon, authenticated;
grant execute on function private.workspace_feature_enabled(uuid, text) to authenticated;

-- Migrate legacy rows only when their restaurant identifies a workspace. The
-- old table remains in place for compatibility, but new delivery code uses the
-- workspace-aware table below.
insert into public.workspace_push_subscriptions (
  workspace_id,
  user_id,
  endpoint,
  p256dh,
  auth,
  user_agent,
  status,
  last_seen_at,
  revoked_at,
  created_at,
  updated_at
)
select
  restaurant.workspace_id,
  legacy.user_id,
  legacy.endpoint,
  legacy.p256dh,
  legacy.auth,
  legacy.user_agent,
  case when legacy.enabled then 'active' else 'revoked' end,
  legacy.updated_at,
  case when legacy.enabled then null else legacy.updated_at end,
  legacy.created_at,
  legacy.updated_at
from public.admin_push_subscriptions as legacy
join public.restaurants as restaurant on restaurant.id = legacy.restaurant_id
join public.workspace_members as membership
  on membership.workspace_id = restaurant.workspace_id
 and membership.user_id = legacy.user_id
where restaurant.workspace_id is not null
on conflict (workspace_id, user_id, endpoint) do update
set p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    status = excluded.status,
    last_seen_at = excluded.last_seen_at,
    revoked_at = excluded.revoked_at,
    updated_at = now();

alter table public.workspace_pwa_settings enable row level security;
alter table public.workspace_push_subscriptions enable row level security;

drop policy if exists "Workspace members can read PWA settings" on public.workspace_pwa_settings;
create policy "Workspace members can read PWA settings"
  on public.workspace_pwa_settings for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "Owners and admins can manage PWA settings" on public.workspace_pwa_settings;
create policy "Owners and admins can manage PWA settings"
  on public.workspace_pwa_settings for all
  to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    and private.workspace_feature_enabled(workspace_id, 'customPWA')
  )
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    and private.workspace_feature_enabled(workspace_id, 'customPWA')
  );

drop policy if exists "Members can read own workspace push subscriptions" on public.workspace_push_subscriptions;
create policy "Members can read own workspace push subscriptions"
  on public.workspace_push_subscriptions for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_workspace_member(workspace_id)
  );

drop policy if exists "Members can manage own workspace push subscriptions" on public.workspace_push_subscriptions;
create policy "Members can manage own workspace push subscriptions"
  on public.workspace_push_subscriptions for all
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

grant select, insert, update, delete on public.workspace_pwa_settings to authenticated;
grant select, insert, update, delete on public.workspace_push_subscriptions to authenticated;

-- Extend the existing public bucket path guard with workspace PWA icons. The
-- bucket remains public-read because icons are intentionally public-safe, but
-- only Owner/Admin members of an entitled workspace may write these paths.
create or replace function private.can_manage_restaurant_asset_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, storage
as $$
declare
  parts text[];
  workspace_id_value uuid;
  restaurant_id_value uuid;
begin
  if object_name ~ '^[0-9a-fA-F-]{36}/pwa/icon/[^/]+$' then
    parts := storage.foldername(object_name);
    begin
      workspace_id_value := parts[1]::uuid;
    exception when invalid_text_representation then
      return false;
    end;

    return exists (
      select 1
      from public.workspace_members as membership
      join public.workspaces as workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = workspace_id_value
        and membership.user_id = auth.uid()
        and membership.role in ('owner', 'admin')
        and workspace.status = 'active'
        and private.workspace_feature_enabled(workspace_id_value, 'customPWA')
    );
  end if;

  if object_name !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/(logo|primary)/[^/]+$' then
    return false;
  end if;

  parts := storage.foldername(object_name);
  begin
    workspace_id_value := parts[1]::uuid;
    restaurant_id_value := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if not exists (
    select 1
    from public.restaurants as restaurant
    join public.workspace_members as membership on membership.workspace_id = restaurant.workspace_id
    join public.workspaces as workspace on workspace.id = membership.workspace_id
    where restaurant.id = restaurant_id_value
      and restaurant.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin', 'manager')
      and workspace.status = 'active'
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin')
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role = 'manager'
      and membership.restaurant_access_mode = 'all'
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.workspace_member_restaurants as assignment
    join public.workspace_members as membership on membership.id = assignment.member_id
    where assignment.restaurant_id = restaurant_id_value
      and membership.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role = 'manager'
  );
end;
$$;

revoke all on function private.can_manage_restaurant_asset_path(text) from public, anon;
grant execute on function private.can_manage_restaurant_asset_path(text) to authenticated;

notify pgrst, 'reload schema';
