begin;

-- The provider enum constraints are additive. Existing Paddle rows remain
-- readable as historical billing evidence while new writes default to Stripe.
alter table public.workspace_subscriptions
  drop constraint if exists workspace_subscriptions_provider_check,
  drop constraint if exists workspace_subscriptions_source_check,
  drop constraint if exists workspace_subscriptions_status_check,
  add constraint workspace_subscriptions_provider_check
    check (provider is null or provider in ('paddle', 'stripe')),
  add constraint workspace_subscriptions_source_check
    check (source in ('manual', 'system', 'paddle', 'provider')),
  add constraint workspace_subscriptions_status_check
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'paused', 'pending', 'expired', 'unpaid'));

alter table public.workspace_subscriptions
  add column billing_projection_revision bigint not null default 0 check (billing_projection_revision >= 0),
  add column billing_projection_lease_token uuid,
  add column billing_projection_lease_until timestamptz,
  add constraint workspace_subscriptions_projection_lease_pair_check
    check ((billing_projection_lease_token is null) = (billing_projection_lease_until is null));

alter table public.billing_provider_prices
  drop constraint if exists billing_provider_prices_provider_check,
  add constraint billing_provider_prices_provider_check
    check (provider in ('paddle', 'stripe'));

alter table public.billing_webhook_events
  drop constraint if exists billing_webhook_events_provider_check,
  add constraint billing_webhook_events_provider_check
    check (provider in ('paddle', 'stripe'));

alter table public.billing_checkout_sessions
  drop constraint if exists billing_checkout_sessions_provider_check,
  add constraint billing_checkout_sessions_provider_check
    check (provider in ('paddle', 'stripe'));

alter table public.billing_checkout_sessions
  alter column provider set default 'stripe';

-- A short database lease serializes different verified events for one
-- Workspace. The revision fences workers whose lease expired during a Stripe
-- network request. The caller finalizes its projection with both returned
-- values in the UPDATE predicate, then clears the lease and advances revision.
create or replace function public.claim_billing_projection(
  p_workspace_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 30
)
returns table (lease_revision bigint, lease_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_workspace_id is null or p_lease_token is null then
    return;
  end if;

  return query
  update public.workspace_subscriptions subscription
  set billing_projection_revision = subscription.billing_projection_revision + 1,
      billing_projection_lease_token = p_lease_token,
      billing_projection_lease_until = clock_timestamp() + make_interval(secs => greatest(5, least(coalesce(p_lease_seconds, 30), 120)))
  where subscription.workspace_id = p_workspace_id
    and (subscription.billing_projection_lease_token is null or subscription.billing_projection_lease_until <= clock_timestamp())
  returning subscription.billing_projection_revision, subscription.billing_projection_lease_until;
end;
$$;

create or replace function public.release_billing_projection(
  p_workspace_id uuid,
  p_lease_token uuid,
  p_lease_revision bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workspace_subscriptions subscription
  set billing_projection_lease_token = null,
      billing_projection_lease_until = null,
      billing_projection_revision = subscription.billing_projection_revision + 1
  where subscription.workspace_id = p_workspace_id
    and subscription.billing_projection_lease_token = p_lease_token
    and subscription.billing_projection_revision = p_lease_revision;
  return found;
end;
$$;

revoke all on function public.claim_billing_projection(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_billing_projection(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.claim_billing_projection(uuid, uuid, integer) to service_role;
grant execute on function public.release_billing_projection(uuid, uuid, bigint) to service_role;

comment on column public.workspace_subscriptions.billing_projection_revision is
  'Monotonic compare-and-swap fence for authoritative provider reconciliation.';
comment on column public.workspace_subscriptions.billing_projection_lease_token is
  'Server-only lease token serializing provider projections for this Workspace.';
comment on function public.claim_billing_projection(uuid, uuid, integer) is
  'Claims a short Workspace billing projection lease for service-role reconciliation.';

commit;
