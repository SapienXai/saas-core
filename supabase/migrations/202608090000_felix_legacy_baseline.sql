-- Reservevia clean-development baseline.
--
-- scripts/sql/001-017 are preserved as the historical operational record.
-- They are not a complete fresh-install lifecycle: later application columns,
-- triggers and the current reservation shape were added incrementally. This
-- migration captures the current Felix-compatible schema needed by the app so
-- `supabase db reset` can build a safe local database from zero. It is not a
-- production-data migration and contains only deterministic development seed
-- rows for the four restaurants already defined in lib/seed-data.ts.

create extension if not exists pgcrypto;

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  cuisine text,
  hours text,
  atmosphere text,
  phone text,
  location text,
  media_type text default 'slideshow',
  reservation_enabled boolean not null default true,
  allowed_days_of_week integer[] not null default '{1,2,3,4,5,6,7}',
  opening_time time not null default '09:00',
  closing_time time not null default '22:00',
  time_slot_duration integer not null default 30,
  advance_booking_days integer not null default 30,
  min_advance_hours integer not null default 2,
  max_party_size integer not null default 12,
  min_party_size integer not null default 1,
  reservation_start_date date,
  reservation_blocked_intervals jsonb not null default '[]'::jsonb,
  reservation_notices jsonb not null default '[]'::jsonb,
  blocked_dates date[] not null default '{}',
  special_hours jsonb not null default '{}'::jsonb,
  meal_only_reservations boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurants_media_type_check check (media_type is null or media_type in ('slideshow', 'video')),
  constraint restaurants_time_slot_duration_check check (time_slot_duration > 0 and time_slot_duration <= 240),
  constraint restaurants_advance_booking_days_check check (advance_booking_days >= 0 and advance_booking_days <= 365),
  constraint restaurants_min_advance_hours_check check (min_advance_hours >= 0 and min_advance_hours <= 168),
  constraint restaurants_party_size_range_check check (min_party_size > 0 and max_party_size >= min_party_size),
  constraint restaurants_opening_closing_time_check check (opening_time < closing_time),
  constraint restaurants_allowed_days_check check (cardinality(allowed_days_of_week) > 0 and allowed_days_of_week <@ '{1,2,3,4,5,6,7}')
);

create table public.restaurant_media (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  media_url text not null,
  media_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  email_notifications boolean not null default true,
  sms_notifications boolean not null default false,
  notification_emails text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_settings_restaurant_key unique (restaurant_id)
);

create table public.reservation_areas (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  opening_time time,
  closing_time time,
  time_slot_duration integer,
  max_party_size integer,
  min_party_size integer,
  advance_booking_days integer,
  min_advance_hours integer,
  allowed_days_of_week integer[],
  blocked_dates date[] not null default '{}',
  special_hours jsonb not null default '{}'::jsonb,
  max_concurrent_reservations integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservation_areas_name_key unique (restaurant_id, name),
  constraint reservation_areas_time_slot_duration_check check (time_slot_duration is null or (time_slot_duration > 0 and time_slot_duration <= 240)),
  constraint reservation_areas_advance_booking_days_check check (advance_booking_days is null or (advance_booking_days >= 0 and advance_booking_days <= 365)),
  constraint reservation_areas_min_advance_hours_check check (min_advance_hours is null or (min_advance_hours >= 0 and min_advance_hours <= 168)),
  constraint reservation_areas_party_size_range_check check ((min_party_size is null and max_party_size is null) or (min_party_size is not null and max_party_size is not null and min_party_size > 0 and max_party_size >= min_party_size)),
  constraint reservation_areas_display_order_check check (display_order >= 0),
  constraint reservation_areas_max_concurrent_check check (max_concurrent_reservations is null or max_concurrent_reservations > 0)
);

create table public.admin_profiles (
  id uuid primary key,
  full_name text,
  role text not null default 'staff' check (role in ('admin', 'manager', 'staff', 'readonly')),
  restaurant_id uuid references public.restaurants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reservation_area_id uuid references public.reservation_areas(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  party_size integer not null check (party_size > 0),
  reservation_date date not null,
  reservation_time time not null,
  special_requests text,
  status text default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
  notes text,
  table_number text,
  reservation_type text default 'meal' check (reservation_type in ('meal', 'drinks')),
  booking_source text not null default 'online',
  booked_by_user_id uuid references public.admin_profiles(id) on delete set null,
  booked_by_label text,
  last_update_summary jsonb,
  last_updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_profiles(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_restaurant_media_restaurant_order on public.restaurant_media (restaurant_id, media_order);
create index idx_reservation_areas_restaurant_id on public.reservation_areas (restaurant_id);
create index idx_reservation_areas_active on public.reservation_areas (restaurant_id, is_active);
create index idx_reservations_restaurant_date on public.reservations (restaurant_id, reservation_date);
create index idx_reservations_restaurant_created on public.reservations (restaurant_id, created_at desc);
create index idx_reservations_restaurant_status_date on public.reservations (restaurant_id, status, reservation_date);
create index idx_reservations_created_at on public.reservations (created_at desc);
create index idx_reservations_area_id on public.reservations (reservation_area_id);
create index idx_reservations_booked_by_user_id on public.reservations (booked_by_user_id);
create index idx_admin_profiles_restaurant_id on public.admin_profiles (restaurant_id);
create index idx_admin_push_subscriptions_user_id on public.admin_push_subscriptions (user_id);
create index idx_admin_push_subscriptions_restaurant_id on public.admin_push_subscriptions (restaurant_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger restaurants_set_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();
create trigger notification_settings_set_updated_at
  before update on public.notification_settings
  for each row execute function public.set_updated_at();
create trigger reservation_areas_set_updated_at
  before update on public.reservation_areas
  for each row execute function public.set_updated_at();
create trigger admin_profiles_set_updated_at
  before update on public.admin_profiles
  for each row execute function public.set_updated_at();
create trigger reservations_set_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();
create trigger admin_push_subscriptions_set_updated_at
  before update on public.admin_push_subscriptions
  for each row execute function public.set_updated_at();

create or replace function public.validate_reservation_type()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.restaurants
    where id = new.restaurant_id
      and meal_only_reservations = true
      and new.reservation_type = 'drinks'
  ) then
    raise exception 'This restaurant only accepts meal reservations';
  end if;
  return new;
end;
$$;

create trigger reservations_validate_type
  before insert or update on public.reservations
  for each row execute function public.validate_reservation_type();

create or replace function public.get_area_effective_settings(area_id uuid)
returns table (
  opening_time time,
  closing_time time,
  time_slot_duration integer,
  max_party_size integer,
  min_party_size integer,
  advance_booking_days integer,
  min_advance_hours integer,
  allowed_days_of_week integer[]
)
language sql
stable
as $$
  select
    coalesce(area.opening_time, restaurant.opening_time),
    coalesce(area.closing_time, restaurant.closing_time),
    coalesce(area.time_slot_duration, restaurant.time_slot_duration),
    coalesce(area.max_party_size, restaurant.max_party_size),
    coalesce(area.min_party_size, restaurant.min_party_size),
    coalesce(area.advance_booking_days, restaurant.advance_booking_days),
    coalesce(area.min_advance_hours, restaurant.min_advance_hours),
    coalesce(area.allowed_days_of_week, restaurant.allowed_days_of_week)
  from public.reservation_areas area
  join public.restaurants restaurant on restaurant.id = area.restaurant_id
  where area.id = get_area_effective_settings.area_id;
$$;

create or replace function public.get_dashboard_stats(
  p_restaurant_id uuid default null,
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  total bigint,
  pending bigint,
  confirmed bigint,
  cancelled bigint,
  percent_change integer,
  total_kuver bigint,
  total_meal_reservations bigint,
  deck_kuvers bigint,
  terrace_kuvers bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select r.status, r.party_size, r.reservation_type, area.name as area_name
    from public.reservations r
    left join public.reservation_areas area on area.id = r.reservation_area_id
    where (p_restaurant_id is null or r.restaurant_id = p_restaurant_id)
      and (p_start_date is null or r.reservation_date >= p_start_date)
      and (p_end_date is null or r.reservation_date <= p_end_date)
  ), current_counts as (
    select
      count(*) as total,
      count(*) filter (where coalesce(status, 'pending') = 'pending') as pending,
      count(*) filter (where status = 'confirmed') as confirmed,
      count(*) filter (where status = 'cancelled') as cancelled,
      coalesce(sum(party_size) filter (where status = 'confirmed'), 0) as total_kuver,
      count(*) filter (where reservation_type = 'meal') as total_meal_reservations,
      coalesce(sum(party_size) filter (where status = 'confirmed' and coalesce(area_name, '') ilike '%deck%'), 0) as deck_kuvers,
      coalesce(sum(party_size) filter (where status = 'confirmed' and coalesce(area_name, '') ilike '%terrace%'), 0) as terrace_kuvers
    from scoped
  ), comparison as (
    select
      count(*) filter (where r.created_at >= now() - interval '1 month' and r.created_at < now()) as last_month_count,
      count(*) filter (where r.created_at >= now() - interval '2 months' and r.created_at < now() - interval '1 month') as two_months_ago_count
    from public.reservations r
    where (p_restaurant_id is null or r.restaurant_id = p_restaurant_id)
  )
  select
    current_counts.total,
    current_counts.pending,
    current_counts.confirmed,
    current_counts.cancelled,
    case when comparison.two_months_ago_count > 0 then round(((comparison.last_month_count - comparison.two_months_ago_count)::numeric / comparison.two_months_ago_count::numeric) * 100)::integer else 0 end,
    current_counts.total_kuver,
    current_counts.total_meal_reservations,
    current_counts.deck_kuvers,
    current_counts.terrace_kuvers
  from current_counts, comparison;
$$;

alter table public.restaurants enable row level security;
alter table public.restaurant_media enable row level security;
alter table public.notification_settings enable row level security;
alter table public.reservation_areas enable row level security;
alter table public.reservations enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.admin_push_subscriptions enable row level security;

create policy "Public read restaurants" on public.restaurants for select using (true);
create policy "Public read media" on public.restaurant_media for select using (true);
create policy "Public read reservation areas" on public.reservation_areas for select using (is_active = true);
create policy "Read own admin profile" on public.admin_profiles for select using (auth.uid() = id);
create policy "Read own push subscriptions" on public.admin_push_subscriptions for select using (auth.uid() = user_id);
create policy "Manage own push subscriptions" on public.admin_push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'reservations'
     ) then
    alter publication supabase_realtime add table public.reservations;
  end if;
end;
$$;

-- Deterministic local Felix fixtures. These are not production records.
insert into public.restaurants (
  id, name, description, cuisine, hours, atmosphere, phone, location, media_type,
  reservation_enabled, opening_time, closing_time, time_slot_duration,
  advance_booking_days, min_advance_hours, max_party_size, min_party_size
)
values
  ('00000000-0000-4000-8000-000000000001', 'Felix Beach', 'Dine with your toes in the sand and the sound of waves as your backdrop', 'Mediterranean', '12PM - 10PM', 'Relaxing', '+12345678901', 'Felix+Beach', 'slideshow', true, '12:00', '22:00', 30, 30, 2, 12, 1),
  ('00000000-0000-4000-8000-000000000002', 'Felix Garden', 'A lush oasis where nature and culinary artistry blend seamlessly', 'Farm-to-Table', '11AM - 9PM', 'Serene', '+12345678902', 'Felix+Garden', 'video', true, '11:00', '21:00', 30, 30, 2, 12, 1),
  ('00000000-0000-4000-8000-000000000003', 'Felix Marina', 'Elegant waterfront dining with stunning views of luxury yachts', 'Seafood', '5PM - 11PM', 'Upscale', '+12345678903', 'Felix+Marina', 'slideshow', true, '17:00', '23:00', 30, 30, 2, 12, 1),
  ('00000000-0000-4000-8000-000000000004', 'Felix Selimiye', 'Traditional flavors with a modern twist in a historic setting', 'Turkish Fusion', '4PM - 12AM', 'Lively', '+12345678904', 'Felix+Selimiye', 'slideshow', true, '16:00', '23:59', 30, 30, 2, 12, 1);

insert into public.restaurant_media (restaurant_id, media_url, media_order)
values
  ('00000000-0000-4000-8000-000000000001', '/assets/beach1.jpeg', 0),
  ('00000000-0000-4000-8000-000000000001', '/assets/beach2.jpeg', 1),
  ('00000000-0000-4000-8000-000000000002', 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/garden-oRA3ycYMsw6eyb1694bRzBCKGHaF6Y.mp4', 0),
  ('00000000-0000-4000-8000-000000000003', '/assets/marina1.jpeg', 0),
  ('00000000-0000-4000-8000-000000000003', '/assets/marina2.jpeg', 1),
  ('00000000-0000-4000-8000-000000000004', '/assets/selimiye1.jpeg', 0),
  ('00000000-0000-4000-8000-000000000004', '/assets/selimiye2.jpeg', 1),
  ('00000000-0000-4000-8000-000000000004', '/assets/selimiye3.jpeg', 2);

insert into public.notification_settings (restaurant_id, notification_emails)
select id, array['admin@felixrestaurants.com']::text[]
from public.restaurants;
