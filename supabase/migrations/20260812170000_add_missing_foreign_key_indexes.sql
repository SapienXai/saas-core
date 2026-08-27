-- Keep foreign-key maintenance and common authorization joins index-backed.
create index if not exists reservations_last_updated_by_user_idx
  on public.reservations (last_updated_by_user_id);

create index if not exists billing_checkout_sessions_target_plan_idx
  on public.billing_checkout_sessions (target_plan_key);

create index if not exists restaurant_domains_created_by_idx
  on public.restaurant_domains (created_by);

create index if not exists workspace_invitations_invited_by_idx
  on public.workspace_invitations (invited_by);

create index if not exists workspace_pwa_settings_updated_by_idx
  on public.workspace_pwa_settings (updated_by);

create index if not exists platform_members_created_by_idx
  on public.platform_members (created_by);

create index if not exists platform_user_controls_suspended_by_idx
  on public.platform_user_controls (suspended_by);

create index if not exists platform_settings_updated_by_idx
  on public.platform_settings (updated_by);

create index if not exists subscription_overrides_created_by_idx
  on public.subscription_overrides (created_by);

create index if not exists subscription_overrides_plan_key_idx
  on public.subscription_overrides (plan_key);

create index if not exists subscription_overrides_revoked_by_idx
  on public.subscription_overrides (revoked_by);
