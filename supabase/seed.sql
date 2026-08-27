-- Local-only Reservevia test fixtures. Never use this seed on production.

insert into public.workspaces (id, name, slug, status)
values ('00000000-0000-4000-8000-000000000010', 'Test Restaurant Group', 'test-restaurant-group', 'active')
on conflict (id) do nothing;

-- The workspace INSERT trigger assigns Free automatically. Keep the fixture
-- explicit as well so the intended development commercial state is obvious
-- and remains correct if the seed row already exists.
insert into public.workspace_subscriptions (
  workspace_id, plan_key, status, source, current_period_start, current_period_end
)
values (
  '00000000-0000-4000-8000-000000000010',
  'free',
  'active',
  'free',
  date_trunc('month', current_date)::date,
  (date_trunc('month', current_date) + interval '1 month')::date
)
on conflict (workspace_id) do update set
  plan_key = excluded.plan_key,
  status = excluded.status,
  source = excluded.source,
  current_period_start = excluded.current_period_start,
  current_period_end = excluded.current_period_end,
  updated_at = now();

insert into public.restaurants (
  id, workspace_id, name, description, cuisine, hours, atmosphere, phone, location,
  slug, logo_url, primary_image_url, whatsapp, menu_url, location_url, events_url,
  timezone, language, status, media_type, reservation_enabled, opening_time, closing_time, time_slot_duration,
  advance_booking_days, min_advance_hours, max_party_size, min_party_size
)
values (
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000010',
  'Test Restaurant',
  'A local-only restaurant used for tenant isolation tests.',
  'Test Cuisine',
  '10:00 - 22:00',
  'Test',
  '+10000000000',
  'Test location',
  'test-restaurant',
  null,
  null,
  null,
  null,
  null,
  null,
  'UTC',
  'en',
  'published',
  'slideshow',
  true,
  '10:00',
  '22:00',
  30,
  30,
  0,
  12,
  1
)
on conflict (id) do nothing;

insert into public.reservation_areas (id, restaurant_id, name, is_active, display_order)
values
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'Beach', true, 0),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000011', 'Main Room', true, 0)
on conflict (id) do nothing;

insert into public.reservations (
  id, restaurant_id, reservation_area_id, customer_name, customer_phone,
  customer_email, party_size, reservation_date, reservation_time, status,
  reservation_type, booking_source, booked_by_label
)
values
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', 'Felix Test Guest', '+10000000001', 'felix-test@example.test', 2, current_date + 1, '18:00', 'confirmed', 'meal', 'online', 'Local seed'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000013', 'Tenant Test Guest', '+10000000002', 'tenant-test@example.test', 2, current_date + 1, '19:00', 'pending', 'meal', 'online', 'Local seed')
on conflict (id) do nothing;
