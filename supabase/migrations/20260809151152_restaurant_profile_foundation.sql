-- Reservevia forward migration 004: unified restaurant public profile.
-- The reservation engine and the legacy restaurant_media table remain intact.
-- This adds one controlled public profile surface: one logo and one primary
-- image per restaurant.

create schema if not exists private;

alter table public.restaurants
  add column if not exists slug text,
  add column if not exists logo_url text,
  add column if not exists primary_image_url text,
  add column if not exists whatsapp text,
  add column if not exists menu_url text,
  add column if not exists location_url text,
  add column if not exists events_url text,
  add column if not exists timezone text not null default 'UTC',
  add column if not exists language text not null default 'en',
  add column if not exists status text not null default 'published';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_public_status_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_public_status_check
      check (status in ('published', 'unpublished'));
  end if;
end $$;

-- Known inherited restaurants receive stable slugs. The fallback keeps
-- unexpected future rows deterministic without turning Felix names into
-- runtime assumptions.
update public.restaurants
set slug = case lower(name)
  when 'felix beach' then 'felix-beach'
  when 'felix garden' then 'felix-garden'
  when 'felix marina' then 'felix-marina'
  when 'felix selimiye' then 'felix-selimiye'
  when 'test restaurant' then 'test-restaurant'
  else slug
end
where slug is null;

do $$
declare
  restaurant record;
  base_slug text;
  candidate_slug text;
  suffix integer;
begin
  for restaurant in
    select id, name
    from public.restaurants
    where slug is null
    order by created_at, id
  loop
    base_slug := lower(trim(both '-' from regexp_replace(restaurant.name, '[^a-zA-Z0-9]+', '-', 'g')));
    if base_slug = '' or base_slug in ('www', 'app', 'api', 'admin', 'manage', 'login', 'signup', 'pricing', 'help', 'support', 'status', 'mail', 'assets', 'static') then
      base_slug := 'restaurant-' || left(replace(restaurant.id::text, '-', ''), 12);
    end if;

    candidate_slug := left(base_slug, 56);
    suffix := 2;
    while exists (select 1 from public.restaurants where slug = candidate_slug) loop
      candidate_slug := left(base_slug, 56) || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;

    update public.restaurants
    set slug = candidate_slug
    where id = restaurant.id;
  end loop;
end $$;

create unique index if not exists restaurants_slug_key on public.restaurants (slug);
alter table public.restaurants alter column slug set not null;

-- Preserve the current Felix profile assets without exposing the legacy media
-- collection as the new public content model. A video is intentionally not
-- promoted to the primary image field.
update public.restaurants
set logo_url = '/assets/felix.png'
where logo_url is null and lower(name) like 'felix %';

update public.restaurants restaurant
set primary_image_url = (
  select media.media_url
  from public.restaurant_media media
  where media.restaurant_id = restaurant.id
    and lower(media.media_url) ~ '\.(avif|gif|jpe?g|png|webp)(\?.*)?$'
  order by media.media_order, media.created_at
  limit 1
)
where restaurant.primary_image_url is null
  and exists (
    select 1
    from public.restaurant_media media
    where media.restaurant_id = restaurant.id
      and lower(media.media_url) ~ '\.(avif|gif|jpe?g|png|webp)(\?.*)?$'
  );

update public.restaurants
set timezone = 'Europe/Istanbul', language = 'en'
where lower(name) like 'felix %';

comment on column public.restaurants.slug is 'Stable globally unique public identifier. Name changes must not silently change it.';
comment on column public.restaurants.logo_url is 'One public restaurant logo asset URL.';
comment on column public.restaurants.primary_image_url is 'One public restaurant primary/banner image URL. Galleries remain legacy compatibility only.';
comment on column public.restaurants.status is 'Public profile publication state. Unpublished restaurants have no public profile route.';

-- Harden the Phase 1 SECURITY DEFINER helpers: policies still use them, but
-- direct anonymous calls must not be able to invoke them. The user override
-- remains for the existing signatures but can no longer inspect another user.
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
  select target_user_id is not distinct from auth.uid()
    and exists (
      select 1
      from public.workspace_members membership
      join public.workspaces workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = target_workspace_id
        and membership.user_id = auth.uid()
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
  select target_user_id is not distinct from auth.uid()
    and exists (
      select 1
      from public.workspace_members membership
      join public.workspaces workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = target_workspace_id
        and membership.user_id = auth.uid()
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
  select target_user_id is not distinct from auth.uid()
    and exists (
      select 1
      from public.restaurants restaurant
      join public.workspace_members membership on membership.workspace_id = restaurant.workspace_id
      join public.workspaces workspace on workspace.id = membership.workspace_id
      where restaurant.id = target_restaurant_id
        and membership.user_id = auth.uid()
        and workspace.status = 'active'
        and (
          membership.role in ('owner', 'admin', 'manager')
          or exists (
            select 1
            from public.admin_profiles profile
            where profile.id = auth.uid()
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
  select target_user_id is not distinct from auth.uid()
    and exists (
      select 1
      from public.restaurants restaurant
      join public.workspace_members membership on membership.workspace_id = restaurant.workspace_id
      join public.workspaces workspace on workspace.id = membership.workspace_id
      where restaurant.id = target_restaurant_id
        and membership.user_id = auth.uid()
        and workspace.status = 'active'
        and (
          membership.role in ('owner', 'admin', 'manager')
          or (
            membership.role = 'staff'
            and exists (
              select 1
              from public.admin_profiles profile
              where profile.id = auth.uid()
                and profile.restaurant_id = target_restaurant_id
            )
          )
        )
    );
$$;

revoke execute on function public.is_workspace_member(uuid, uuid) from public, anon;
revoke execute on function public.has_workspace_role(uuid, text[], uuid) from public, anon;
revoke execute on function public.can_access_restaurant(uuid, uuid) from public, anon;
revoke execute on function public.can_operate_restaurant(uuid, uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, text[], uuid) to authenticated;
grant execute on function public.can_access_restaurant(uuid, uuid) to authenticated;
grant execute on function public.can_operate_restaurant(uuid, uuid) to authenticated;

-- Storage writes are authenticated and scoped to workspace/restaurant paths.
-- Reads are public because these are intentionally public restaurant assets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-assets',
  'restaurant-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']::text[]
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = excluded.allowed_mime_types;

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

  return exists (
    select 1
    from public.restaurants restaurant
    join public.workspace_members membership on membership.workspace_id = restaurant.workspace_id
    join public.workspaces workspace on workspace.id = membership.workspace_id
    where restaurant.id = restaurant_id_value
      and restaurant.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin', 'manager')
      and workspace.status = 'active'
  );
end;
$$;

revoke all on function private.can_manage_restaurant_asset_path(text) from public, anon;
grant execute on function private.can_manage_restaurant_asset_path(text) to authenticated;

drop policy if exists "Public can read restaurant assets" on storage.objects;
create policy "Public can read restaurant assets"
  on storage.objects for select
  using (bucket_id = 'restaurant-assets');

drop policy if exists "Workspace managers can upload restaurant assets" on storage.objects;
create policy "Workspace managers can upload restaurant assets"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'restaurant-assets' and private.can_manage_restaurant_asset_path(name));

drop policy if exists "Workspace managers can replace restaurant assets" on storage.objects;
create policy "Workspace managers can replace restaurant assets"
  on storage.objects for update to authenticated
  using (bucket_id = 'restaurant-assets' and private.can_manage_restaurant_asset_path(name))
  with check (bucket_id = 'restaurant-assets' and private.can_manage_restaurant_asset_path(name));

drop policy if exists "Workspace managers can delete restaurant assets" on storage.objects;
create policy "Workspace managers can delete restaurant assets"
  on storage.objects for delete to authenticated
  using (bucket_id = 'restaurant-assets' and private.can_manage_restaurant_asset_path(name));
