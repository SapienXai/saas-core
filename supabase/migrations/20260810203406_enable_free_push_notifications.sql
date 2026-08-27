-- Push notifications are included for every plan, including Free.
update public.plans
set features = jsonb_set(
  coalesce(features, '{}'::jsonb),
  '{pushNotifications}',
  'true'::jsonb,
  true
)
where key = 'free';
