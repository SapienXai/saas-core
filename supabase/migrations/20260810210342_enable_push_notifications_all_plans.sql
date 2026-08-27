-- Push notifications are included in every Reservevia pricing plan.
update public.plans
set features = jsonb_set(
  coalesce(features, '{}'::jsonb),
  '{pushNotifications}',
  'true'::jsonb,
  true
)
where key in ('free', 'starter', 'pro', 'business');
