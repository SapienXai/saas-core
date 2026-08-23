-- Local-only deterministic core catalog. Product seed data belongs in the product.
insert into public.plans(key, name, active, billing, features, limits)
values
  ('free', 'Free', true, '{"currency":"USD","monthlyPriceCents":0}', '{"core":true}', '{"users":1,"api_calls":1000}'),
  ('starter', 'Starter', true, '{"currency":"USD","monthlyPriceCents":1900}', '{"core":true}', '{"users":3,"api_calls":10000}'),
  ('pro', 'Pro', true, '{"currency":"USD","monthlyPriceCents":4900}', '{"core":true,"customDomain":true,"customPWA":true,"pushNotifications":true}', '{"users":10,"api_calls":100000}'),
  ('business', 'Business', true, '{"currency":"USD","monthlyPriceCents":9900}', '{"core":true,"customDomain":true,"customPWA":true,"pushNotifications":true,"auditExports":true}', '{"users":25,"api_calls":null}')
on conflict (key) do update set name = excluded.name, active = excluded.active, billing = excluded.billing, features = excluded.features, limits = excluded.limits;
