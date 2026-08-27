-- Reservation email delivery is available on every Reservevia plan.
-- Existing workspaces keep their plan and billing state; only the Free
-- catalog capability is corrected so current Free workspaces pick it up.

update public.plans
set features = jsonb_set(
  coalesce(features, '{}'::jsonb),
  '{emailNotifications}',
  'true'::jsonb,
  true
),
updated_at = now()
where key = 'free';
