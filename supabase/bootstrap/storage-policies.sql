-- Reservevia production Storage bootstrap.
-- Supabase owns the storage schema; this file only creates the application
-- bucket and its tenant-scoped policies after the schema bootstrap.

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dataengine-import-assets',
  'dataengine-import-assets',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = excluded.allowed_mime_types;

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
