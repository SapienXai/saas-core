-- Reservevia production catalog seed.
-- This file intentionally contains system catalog data only: no users,
-- workspaces, restaurants, reservations, or Felix-compatible fixtures.

insert into public.plans (
  key, name, monthly_price_usd_cents, sort_order, active,
  restaurant_limit, user_limit, reservation_limit, history_days, features
)
values
  (
    'free', 'Free', 0, 10, true,
    1, 1, 100, 30,
    '{"hostedRestaurantPage":true,"emailNotifications":true,"removeReserveviaBranding":false,"customDomain":false,"basicAnalytics":true,"csvExport":false,"guestHistory":false,"automatedNotifications":false,"advancedReports":false,"customPWA":false,"pushNotifications":true,"multiRestaurant":false}'::jsonb
  ),
  (
    'starter', 'Starter', 1900, 20, true,
    1, 3, 500, 365,
    '{"hostedRestaurantPage":true,"emailNotifications":true,"removeReserveviaBranding":true,"customDomain":true,"basicAnalytics":true,"csvExport":true,"guestHistory":false,"automatedNotifications":false,"advancedReports":false,"customPWA":false,"pushNotifications":true,"multiRestaurant":false}'::jsonb
  ),
  (
    'pro', 'Pro', 4900, 30, true,
    1, 10, null, null,
    '{"hostedRestaurantPage":true,"emailNotifications":true,"removeReserveviaBranding":true,"customDomain":true,"basicAnalytics":true,"csvExport":true,"guestHistory":true,"automatedNotifications":true,"advancedReports":true,"customPWA":true,"pushNotifications":true,"multiRestaurant":false}'::jsonb
  ),
  (
    'business', 'Business', 9900, 40, true,
    3, 20, null, null,
    '{"hostedRestaurantPage":true,"emailNotifications":true,"removeReserveviaBranding":true,"customDomain":true,"basicAnalytics":true,"csvExport":true,"guestHistory":true,"automatedNotifications":true,"advancedReports":true,"customPWA":true,"pushNotifications":true,"multiRestaurant":true}'::jsonb
  )
on conflict (key) do update set
  name = excluded.name,
  monthly_price_usd_cents = excluded.monthly_price_usd_cents,
  sort_order = excluded.sort_order,
  active = excluded.active,
  restaurant_limit = excluded.restaurant_limit,
  user_limit = excluded.user_limit,
  reservation_limit = excluded.reservation_limit,
  history_days = excluded.history_days,
  features = excluded.features,
  updated_at = now();
