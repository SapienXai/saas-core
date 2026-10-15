-- Keep current-plan entitlements through the scheduled plan effective timestamp.
-- New consumption is checked against the target plan only after that boundary.

create or replace function public.lock_workspace_entitlement(
  target_workspace_id uuid,
  target_capability text
)
returns table (
  plan_key text,
  capability_configured boolean,
  feature_enabled boolean,
  limit_value integer,
  unlimited boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  capability text := btrim(coalesce(target_capability, ''));
  workspace_status text;
  workspace_platform_status text;
  subscription_row public.workspace_subscriptions%rowtype;
  subscription_exists boolean;
  override_plan_key text;
  fallback_key text;
  candidate_key text;
  selected_plan public.plans%rowtype;
  scheduled_plan public.plans%rowtype;
  active_limit_json jsonb;
  active_limit_present boolean := false;
  active_limit_valid boolean := false;
  effective_limit_value integer;
  effective_unlimited boolean := false;
  effective_limit_configured boolean := false;
  scheduled_at timestamptz;
  pending_scheduled_plan boolean := false;
  scheduled_target_provider_valid boolean := false;
  invalid_provider_projection boolean := false;
  invalid_scheduled_downgrade boolean := false;
  candidate_provider_price_id text;
  now_at timestamptz := now();
begin
  if target_workspace_id is null or capability = '' or capability !~ '^[a-z][a-z0-9_.-]{0,63}$' then
    raise exception using message = 'INVALID_ENTITLEMENT_REQUEST';
  end if;

  -- Every participating product mutation for the same workspace/capability
  -- serializes here, preventing check-then-insert quota races.
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text || ':' || capability, 0));

  select workspace.status, workspace.platform_status
    into workspace_status, workspace_platform_status
    from public.workspaces workspace
   where workspace.id = target_workspace_id;
  if not found or workspace_status <> 'active' or workspace_platform_status <> 'active' then
    raise exception using message = 'WORKSPACE_UNAVAILABLE';
  end if;

  fallback_key := private.core_default_plan_key();
  select *
    into subscription_row
    from public.workspace_subscriptions subscription
   where subscription.workspace_id = target_workspace_id
   for update;
  subscription_exists := found;

  select override_row.plan_key
    into override_plan_key
    from public.subscription_overrides override_row
   where override_row.workspace_id = target_workspace_id
     and override_row.revoked_at is null
     and override_row.effective_from <= now_at
     and (override_row.effective_until is null or override_row.effective_until > now_at)
   order by override_row.effective_from desc
   limit 1;

  candidate_key := fallback_key;
  if override_plan_key is not null then
    candidate_key := override_plan_key;
  elsif subscription_exists then
    if subscription_row.status not in ('active', 'trialing', 'past_due') then
      candidate_key := fallback_key;
    elsif subscription_row.status = 'past_due'
      and (subscription_row.payment_grace_ends_at is null or subscription_row.payment_grace_ends_at <= now_at) then
      candidate_key := fallback_key;
    elsif subscription_row.cancel_at_period_end or subscription_row.scheduled_change_action in ('cancel', 'pause') then
      if coalesce(
        subscription_row.scheduled_effective_at,
        subscription_row.scheduled_change_at,
        subscription_row.current_period_end_at,
        subscription_row.current_period_end::timestamptz
      ) is null or coalesce(
        subscription_row.scheduled_effective_at,
        subscription_row.scheduled_change_at,
        subscription_row.current_period_end_at,
        subscription_row.current_period_end::timestamptz
      ) <= now_at then
        candidate_key := fallback_key;
      else
        candidate_key := subscription_row.plan_key;
      end if;
    elsif subscription_row.scheduled_plan_key is not null then
      if coalesce(subscription_row.scheduled_effective_at, subscription_row.scheduled_plan_at::timestamptz) is null then
        candidate_key := fallback_key;
      elsif coalesce(subscription_row.scheduled_effective_at, subscription_row.scheduled_plan_at::timestamptz) <= now_at then
        candidate_key := subscription_row.scheduled_plan_key;
      else
        candidate_key := subscription_row.plan_key;
      end if;
    else
      candidate_key := subscription_row.plan_key;
    end if;
  end if;

  -- Initial trials are granted by the server and intentionally have no
  -- provider customer, subscription, or price identity. Keep their plan only
  -- while the recorded trial is active; expired or malformed trials fail
  -- closed to the configured fallback just like the shared TypeScript policy.
  if candidate_key <> fallback_key
     and subscription_exists
     and override_plan_key is null
     and subscription_row.source = 'trial'
     and (
       subscription_row.status <> 'trialing'
       or subscription_row.initial_trial_ends_at is null
       or subscription_row.initial_trial_ends_at <= now_at
       or (
         coalesce(
           subscription_row.current_period_end_at,
           subscription_row.current_period_end::timestamp at time zone 'UTC'
         ) is not null
         and coalesce(
           subscription_row.current_period_end_at,
           subscription_row.current_period_end::timestamp at time zone 'UTC'
         ) <= now_at
       )
     ) then
    candidate_key := fallback_key;
    invalid_provider_projection := true;
  end if;

  -- A non-manual paid projection is valid only when the local provider
  -- identity is complete and every future price transition is mapped on the
  -- same provider/environment. Paddle may expose the target price early, but
  -- an unknown third price or an unresolvable target remains fail-closed.
  scheduled_at := case when subscription_exists then coalesce(
    subscription_row.scheduled_effective_at,
    subscription_row.scheduled_plan_at
  ) else null end;
  pending_scheduled_plan := subscription_exists
    and subscription_row.scheduled_plan_key is not null
    and coalesce(subscription_row.scheduled_change_action, '') = ''
    and scheduled_at is not null
    and scheduled_at > now_at;
  scheduled_target_provider_valid := false;
  if pending_scheduled_plan then
    select exists (
      select 1
        from public.plans target_plan
        join public.billing_provider_prices target_price
          on target_price.provider = subscription_row.provider
         and target_price.environment = subscription_row.provider_environment
         and target_price.plan_key = target_plan.key
         and target_price.provider_price_id = subscription_row.scheduled_provider_price_id
         and target_price.active
       where target_plan.key = subscription_row.scheduled_plan_key
         and target_plan.active
    )
      into scheduled_target_provider_valid;
  end if;

  candidate_provider_price_id := case
    when subscription_exists
      and subscription_row.scheduled_plan_key is not null
      and candidate_key = subscription_row.scheduled_plan_key
      and scheduled_at is not null
      and scheduled_at <= now_at
      then subscription_row.scheduled_provider_price_id
    when subscription_exists then subscription_row.provider_price_id
    else null
  end;
  if candidate_key <> fallback_key
     and subscription_exists
     and override_plan_key is null
     and subscription_row.source not in ('manual', 'trial')
     and (
       subscription_row.source = 'system'
       or nullif(btrim(coalesce(subscription_row.provider, '')), '') is null
       or nullif(btrim(coalesce(subscription_row.provider_environment, '')), '') is null
       or nullif(btrim(coalesce(subscription_row.provider_customer_id, '')), '') is null
       or nullif(btrim(coalesce(subscription_row.provider_subscription_id, '')), '') is null
       or nullif(btrim(coalesce(candidate_provider_price_id, '')), '') is null
       or (
         coalesce(subscription_row.current_period_end_at, subscription_row.current_period_end) is not null
         and coalesce(subscription_row.current_period_end_at, subscription_row.current_period_end) <= now_at
       )
       or (
         pending_scheduled_plan
         and not scheduled_target_provider_valid
       )
       or (
         not exists (
           select 1
             from public.billing_provider_prices provider_price
            where provider_price.provider = subscription_row.provider
              and provider_price.environment = subscription_row.provider_environment
              and provider_price.plan_key = candidate_key
              and provider_price.provider_price_id = candidate_provider_price_id
              and provider_price.active
         )
         and not (
           pending_scheduled_plan
           and scheduled_target_provider_valid
           and candidate_provider_price_id = subscription_row.scheduled_provider_price_id
         )
       )
  ) then
    candidate_key := fallback_key;
    invalid_provider_projection := true;
  end if;

  select *
    into selected_plan
    from public.plans plan
   where plan.key = candidate_key and plan.active = true;
  if not found then
    select *
      into selected_plan
      from public.plans plan
     where plan.key = fallback_key and plan.active = true;
  end if;
  if not found then
    raise exception using message = 'SUBSCRIPTION_REQUIRED';
  end if;

  -- Validate a future target, but keep its limits dormant until its effective boundary.
  if subscription_exists
     and subscription_row.scheduled_plan_key is not null
     and not invalid_provider_projection
     and not coalesce(subscription_row.cancel_at_period_end, false)
     and coalesce(subscription_row.scheduled_change_action, '') not in ('cancel', 'pause', 'resume') then
    scheduled_at := coalesce(subscription_row.scheduled_effective_at, subscription_row.scheduled_plan_at::timestamptz);
    if scheduled_at is not null and scheduled_at > now_at then
      select *
        into scheduled_plan
        from public.plans plan
       where plan.key = subscription_row.scheduled_plan_key
         and plan.active = true;
      if not found then
        invalid_scheduled_downgrade := true;
      end if;
    end if;
  end if;

  -- A missing or inactive scheduled target fails closed until the provider projection is corrected.
  if invalid_scheduled_downgrade then
    return query select selected_plan.key, false, false, null::integer, false;
    return;
  end if;

  active_limit_json := selected_plan.limits -> capability;
  active_limit_present := selected_plan.limits ? capability;
  active_limit_valid := active_limit_present and (
    active_limit_json = 'null'::jsonb
    or (
      jsonb_typeof(active_limit_json) = 'number'
      and (selected_plan.limits ->> capability) ~ '^[0-9]+$'
      and (selected_plan.limits ->> capability)::numeric <= 2147483647
    )
  );

  -- The current plan remains authoritative until a scheduled change reaches its effective timestamp.
  effective_limit_configured := active_limit_valid;
  effective_unlimited := active_limit_valid and active_limit_json = 'null'::jsonb;
  if active_limit_valid and not effective_unlimited then
    effective_limit_value := (active_limit_json::text)::integer;
  end if;

  return query
  select
    selected_plan.key,
    (
      not invalid_scheduled_downgrade
      and (
        selected_plan.features ? capability
        and jsonb_typeof(selected_plan.features -> capability) = 'boolean'
      )
    ) or effective_limit_configured,
    case
      when selected_plan.features ? capability and jsonb_typeof(selected_plan.features -> capability) = 'boolean'
        then (selected_plan.features ->> capability)::boolean
      else false
    end,
    case when effective_limit_configured and not effective_unlimited then effective_limit_value else null end,
    effective_limit_configured and effective_unlimited;
end;
$$;

revoke all on function public.lock_workspace_entitlement(uuid, text) from public, anon, authenticated;
grant execute on function public.lock_workspace_entitlement(uuid, text) to service_role;

comment on function public.lock_workspace_entitlement(uuid, text) is
  'Resolves the Core plan effective now and preserves its limits until a scheduled plan transition boundary.';
