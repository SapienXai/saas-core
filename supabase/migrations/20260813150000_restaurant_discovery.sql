-- Add deterministic public discovery quality signals without introducing
-- manual promotion or a second restaurant taxonomy.

create extension if not exists pg_trgm;

alter table public.restaurants
  add column if not exists discovery_score integer generated always as (
    (case when nullif(btrim(primary_image_url), '') is not null then 4 else 0 end)
    + (case when nullif(btrim(description), '') is not null then 2 else 0 end)
    + (case when nullif(btrim(logo_url), '') is not null then 1 else 0 end)
    + (case when nullif(btrim(cuisine), '') is not null then 1 else 0 end)
    + (case when nullif(btrim(atmosphere), '') is not null then 1 else 0 end)
    + (case when nullif(btrim(hours), '') is not null then 1 else 0 end)
    + (case when nullif(btrim(location), '') is not null then 1 else 0 end)
    + (case when nullif(btrim(menu_url), '') is not null then 1 else 0 end)
  ) stored;

comment on column public.restaurants.discovery_score is
  'Computed public discovery quality score. It is not a manual promotion control.';

create index if not exists restaurants_public_discovery_order_idx
  on public.restaurants (discovery_score desc, updated_at desc, name asc, id asc)
  where status = 'published'
    and platform_status = 'active'
    and reservation_enabled = true;

create index if not exists restaurants_public_name_trgm_idx
  on public.restaurants using gin (name gin_trgm_ops)
  where status = 'published'
    and platform_status = 'active'
    and reservation_enabled = true;

create index if not exists restaurants_public_cuisine_trgm_idx
  on public.restaurants using gin (cuisine gin_trgm_ops)
  where status = 'published'
    and platform_status = 'active'
    and reservation_enabled = true;

create index if not exists restaurants_public_atmosphere_trgm_idx
  on public.restaurants using gin (atmosphere gin_trgm_ops)
  where status = 'published'
    and platform_status = 'active'
    and reservation_enabled = true;

create index if not exists restaurants_public_location_trgm_idx
  on public.restaurants using gin (location gin_trgm_ops)
  where status = 'published'
    and platform_status = 'active'
    and reservation_enabled = true;
