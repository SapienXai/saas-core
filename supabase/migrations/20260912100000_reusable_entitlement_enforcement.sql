-- SaaS Core reusable entitlement enforcement boundary.
--
-- Product-owned mutation RPCs can call this function at the start of their
-- transaction, then count and insert their own resource while the advisory
-- transaction lock is held. Core resolves the plan state; the product remains
-- responsible for the resource-specific usage query and insert.

-- PostgREST exposes public schema functions only. Keep the configured
-- fallback lookup server-only while making the private setting reachable by
-- the server runtime without falling back to sort order.
create or replace function public.get_core_default_plan_key()
returns text
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return private.core_default_plan_key();
end;
$$;

revoke all on function public.get_core_default_plan_key() from public, anon, authenticated;
grant execute on function public.get_core_default_plan_key() to service_role;

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
  limit_json jsonb;
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

  -- A non-manual paid projection is valid only when the local provider
  -- identity is complete. A customer record without a subscription, a
  -- missing price, or a system row carrying a paid key must resolve to the
  -- configured fallback rather than granting premium access.
  candidate_provider_price_id := case
    when subscription_exists
      and subscription_row.scheduled_plan_key is not null
      and candidate_key = subscription_row.scheduled_plan_key
      and coalesce(subscription_row.scheduled_effective_at, subscription_row.scheduled_plan_at::timestamptz) is not null
      and coalesce(subscription_row.scheduled_effective_at, subscription_row.scheduled_plan_at::timestamptz) <= now_at
      then subscription_row.scheduled_provider_price_id
    when subscription_exists then subscription_row.provider_price_id
    else null
  end;
  if candidate_key <> fallback_key
     and subscription_exists
     and override_plan_key is null
     and subscription_row.source <> 'manual'
     and (
       subscription_row.source = 'system'
       or nullif(btrim(coalesce(subscription_row.provider, '')), '') is null
       or nullif(btrim(coalesce(subscription_row.provider_environment, '')), '') is null
       or nullif(btrim(coalesce(subscription_row.provider_customer_id, '')), '') is null
       or nullif(btrim(coalesce(subscription_row.provider_subscription_id, '')), '') is null
       or nullif(btrim(coalesce(candidate_provider_price_id, '')), '') is null
       or (
         coalesce(subscription_row.current_period_end_at, subscription_row.current_period_end::timestamptz) is not null
         and coalesce(subscription_row.current_period_end_at, subscription_row.current_period_end::timestamptz) <= now_at
       )
       or not exists (
         select 1
           from public.billing_provider_prices provider_price
          where provider_price.provider = subscription_row.provider
            and provider_price.environment = subscription_row.provider_environment
            and provider_price.plan_key = candidate_key
            and provider_price.provider_price_id = candidate_provider_price_id
            and provider_price.active
       )
     ) then
    candidate_key := fallback_key;
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

  limit_json := selected_plan.limits -> capability;
  return query
  select
    selected_plan.key,
    (
      selected_plan.features ? capability
      and jsonb_typeof(selected_plan.features -> capability) = 'boolean'
    ) or (
      selected_plan.limits ? capability
      and (
        limit_json = 'null'::jsonb
        or (
          jsonb_typeof(limit_json) = 'number'
          and (selected_plan.limits ->> capability) ~ '^[0-9]+$'
        )
      )
    ),
    case
      when selected_plan.features ? capability and jsonb_typeof(selected_plan.features -> capability) = 'boolean'
        then (selected_plan.features ->> capability)::boolean
      else false
    end,
    case
      when selected_plan.limits ? capability
        and jsonb_typeof(limit_json) = 'number'
        and (selected_plan.limits ->> capability) ~ '^[0-9]+$'
        then (selected_plan.limits ->> capability)::integer
      else null
    end,
    (selected_plan.limits ? capability and limit_json = 'null'::jsonb);
end;
$$;

revoke all on function public.lock_workspace_entitlement(uuid, text) from public, anon, authenticated;
grant execute on function public.lock_workspace_entitlement(uuid, text) to service_role;

comment on function public.lock_workspace_entitlement(uuid, text) is
  'Resolves the effective Core plan and holds a workspace/capability transaction lock for a product-owned mutation RPC.';

-- Core-managed membership mutations use the same lock boundary. Pending,
-- unexpired invitations reserve a member slot so concurrent invites cannot
-- overrun a finite member entitlement before acceptance.
create or replace function private.assert_workspace_member_available(
  target_workspace_id uuid,
  excluded_invitation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  entitlement record;
  member_count integer;
  pending_count integer;
begin
  select *
    into entitlement
    from public.lock_workspace_entitlement(target_workspace_id, 'core.members');

  if not entitlement.capability_configured
     or (entitlement.limit_value is null and not entitlement.unlimited) then
    raise exception using message = 'USER_LIMIT_NOT_CONFIGURED';
  end if;
  if entitlement.unlimited then
    return;
  end if;

  select count(*)::integer
    into member_count
    from public.workspace_members
   where workspace_id = target_workspace_id;

  select count(*)::integer
    into pending_count
    from public.workspace_invitations
   where workspace_id = target_workspace_id
     and accepted_at is null
     and revoked_at is null
     and expires_at > now()
     and (excluded_invitation_id is null or id <> excluded_invitation_id);

  if coalesce(member_count, 0) + coalesce(pending_count, 0) >= entitlement.limit_value then
    raise exception using message = 'USER_LIMIT_REACHED';
  end if;
end;
$$;

create or replace function public.create_workspace_invitation(target_workspace_id uuid, target_email text, target_role text, target_token_hash text)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor uuid := auth.uid();
  invite public.workspace_invitations%rowtype;
begin
  if actor is null or not public.has_workspace_role(target_workspace_id, array['owner', 'admin'], actor) then raise exception using message = 'FORBIDDEN'; end if;
  if target_role not in ('admin', 'manager', 'staff', 'readonly') then raise exception using message = 'INVALID_ROLE'; end if;
  if length(btrim(target_email)) < 3 then raise exception using message = 'INVALID_EMAIL'; end if;
  perform private.assert_workspace_member_available(target_workspace_id);
  insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at, invited_by)
  values (target_workspace_id, lower(btrim(target_email)), target_role, target_token_hash, now() + interval '7 days', actor)
  returning * into invite;
  return query select invite.id, invite.expires_at;
end;
$$;

-- Renewals can turn an expired invitation back into a quota-reserving pending
-- seat, so they must use the same transactional member-entitlement boundary
-- as creation and acceptance.
create or replace function public.renew_workspace_invitation(
  target_invitation_id uuid,
  target_token_hash text
)
returns table (invitation_id uuid, email text, role text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor uuid := auth.uid();
  invite public.workspace_invitations%rowtype;
  now_at timestamptz := now();
begin
  if actor is null then raise exception using message = 'AUTH_REQUIRED'; end if;
  if target_invitation_id is null or nullif(btrim(coalesce(target_token_hash, '')), '') is null then
    raise exception using message = 'INVALID_INVITATION_REQUEST';
  end if;
  select * into invite
    from public.workspace_invitations
   where id = target_invitation_id
   for update;
  if not found then raise exception using message = 'INVITATION_NOT_FOUND'; end if;
  if not public.has_workspace_role(invite.workspace_id, array['owner', 'admin'], actor) then
    raise exception using message = 'FORBIDDEN';
  end if;
  if invite.accepted_at is not null or invite.revoked_at is not null then
    raise exception using message = 'INVITATION_NOT_PENDING';
  end if;
  if invite.last_sent_at is not null and invite.last_sent_at > now_at - interval '60 seconds' then
    raise exception using message = 'INVITATION_RESEND_COOLDOWN';
  end if;

  -- Exclude this invitation because an unexpired row already reserves its
  -- seat; an expired row is renewed only when the target plan has capacity.
  perform private.assert_workspace_member_available(invite.workspace_id, invite.id);
  update public.workspace_invitations
     set token_hash = target_token_hash,
         expires_at = now_at + interval '7 days',
         last_sent_at = now_at,
         email_delivery_status = 'pending',
         delivery_error = null,
         updated_at = now_at
   where id = invite.id
   returning id, email, role, expires_at into invite.id, invite.email, invite.role, invite.expires_at;
  return query select invite.id, invite.email, invite.role, invite.expires_at;
end;
$$;

revoke all on function public.renew_workspace_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.renew_workspace_invitation(uuid, text) to authenticated;

create or replace function public.accept_workspace_invitation(target_token_hash text)
returns table (workspace_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor auth.users%rowtype;
  invite public.workspace_invitations%rowtype;
begin
  select * into actor from auth.users where id = auth.uid();
  if actor.id is null then raise exception using message = 'AUTH_REQUIRED'; end if;
  select * into invite from public.workspace_invitations where token_hash = target_token_hash for update;
  if invite.id is null then raise exception using message = 'EXPIRED'; end if;
  if invite.accepted_at is not null then raise exception using message = 'ALREADY_ACCEPTED'; end if;
  if invite.revoked_at is not null or invite.expires_at <= now() then raise exception using message = 'EXPIRED'; end if;
  if lower(coalesce(actor.email, '')) <> lower(invite.email) then raise exception using message = 'EMAIL_MISMATCH'; end if;
  if exists (select 1 from public.workspace_members existing_member where existing_member.workspace_id = invite.workspace_id and existing_member.user_id = actor.id) then
    update public.workspace_invitations set accepted_at = coalesce(accepted_at, now()) where id = invite.id;
    raise exception using message = 'ALREADY_MEMBER';
  end if;
  perform private.assert_workspace_member_available(invite.workspace_id, invite.id);
  insert into public.workspace_members (workspace_id, user_id, role) values (invite.workspace_id, actor.id, invite.role);
  update public.workspace_invitations set accepted_at = now(), updated_at = now() where id = invite.id;
  return query select invite.workspace_id;
end;
$$;

-- Membership and invitation writes must pass through the guarded RPCs (or the
-- server-role application layer). RLS alone cannot enforce a quota atomically.
revoke insert, update, delete on public.workspace_members, public.workspace_invitations from anon, authenticated;
grant select on public.workspace_members, public.workspace_invitations to authenticated;

comment on function private.assert_workspace_member_available(uuid, uuid) is
  'Reserves a Core member slot while a guarded invitation or acceptance transaction is in progress.';

notify pgrst, 'reload schema';
