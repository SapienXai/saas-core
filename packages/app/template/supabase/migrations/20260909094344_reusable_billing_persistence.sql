-- Additive, provider-neutral billing persistence.
-- Existing webhook rows are retained. Rows written before this migration are
-- assigned the live environment because the old table had no environment key.

alter table public.billing_webhook_events
  add column if not exists environment text not null default 'live'
    check (environment in ('sandbox', 'live')),
  add column if not exists max_attempts integer not null default 8
    check (max_attempts between 1 and 20),
  add column if not exists next_attempt_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text;

alter table public.billing_webhook_events
  drop constraint if exists billing_webhook_events_provider_provider_event_id_key;
alter table public.billing_webhook_events
  drop constraint if exists billing_webhook_events_provider_check,
  add constraint billing_webhook_events_provider_nonempty_check
    check (length(btrim(provider)) between 1 and 80);

create unique index if not exists billing_webhook_events_provider_environment_event_key
  on public.billing_webhook_events (provider, environment, provider_event_id);
create index if not exists billing_webhook_events_claim_idx
  on public.billing_webhook_events (status, next_attempt_at, lease_until, received_at);

create table public.billing_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (length(btrim(provider)) between 1 and 80),
  environment text not null check (environment in ('sandbox', 'live')),
  provider_account_id text not null check (length(btrim(provider_account_id)) between 1 and 255),
  provider_customer_id text check (provider_customer_id is null or length(btrim(provider_customer_id)) between 1 and 255),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, environment),
  unique (provider, environment, provider_account_id)
);

create index billing_provider_accounts_workspace_idx
  on public.billing_provider_accounts (workspace_id, provider, environment);

create table public.billing_mutation_transitions (
  id uuid primary key default gen_random_uuid(),
  mutation_id uuid not null references public.billing_mutations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (length(btrim(provider)) between 1 and 80),
  environment text not null check (environment in ('sandbox', 'live')),
  transition_key text not null check (length(btrim(transition_key)) between 1 and 200),
  kind text not null check (kind in ('checkout', 'upgrade', 'downgrade', 'cancel', 'resume', 'renewal', 'recovery')),
  state text not null default 'pending' check (state in ('pending', 'succeeded', 'failed', 'unknown')),
  from_plan_key text,
  to_plan_key text,
  effective_at timestamptz,
  provider_reference text,
  outcome jsonb not null default '{}'::jsonb check (jsonb_typeof(outcome) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, environment, transition_key),
  unique (mutation_id, kind)
);

create index billing_mutation_transitions_workspace_idx
  on public.billing_mutation_transitions (workspace_id, created_at desc);
create index billing_mutation_transitions_retry_idx
  on public.billing_mutation_transitions (state, next_attempt_at, updated_at)
  where state in ('pending', 'unknown');

create table public.billing_transition_consumptions (
  id uuid primary key default gen_random_uuid(),
  transition_id uuid not null references public.billing_mutation_transitions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  consumed_at timestamptz not null default now(),
  unique (workspace_id, user_id, transition_id)
);

create index billing_transition_consumptions_user_idx
  on public.billing_transition_consumptions (workspace_id, user_id, consumed_at desc);

create or replace function public.billing_provider_accounts_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger billing_provider_accounts_set_updated_at
before update on public.billing_provider_accounts
for each row execute function public.billing_provider_accounts_set_updated_at();

create trigger billing_mutation_transitions_set_updated_at
before update on public.billing_mutation_transitions
for each row execute function public.set_updated_at();

-- Unknown means that the provider result still requires reconciliation. It can
-- be resolved later, but it must never be rewritten as an ordinary failure.
create or replace function public.guard_billing_mutation_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = 'succeeded' and new.state <> 'succeeded' then
    raise exception using message = 'SUCCEEDED_TRANSITION_IMMUTABLE';
  end if;
  if old.state = 'unknown' and new.state = 'failed' then
    raise exception using message = 'UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION';
  end if;
  return new;
end;
$$;

create trigger billing_mutation_transitions_guard_state
before update on public.billing_mutation_transitions
for each row execute function public.guard_billing_mutation_transition();

create or replace function public.upsert_billing_provider_account(
  target_workspace_id uuid,
  target_provider text,
  target_environment text,
  target_provider_account_id text,
  target_provider_customer_id text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns table (
  account_id uuid,
  workspace_id uuid,
  provider text,
  environment text,
  provider_account_id text,
  provider_customer_id text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  account public.billing_provider_accounts%rowtype;
begin
  if target_workspace_id is null or not exists (
    select 1
    from public.workspaces workspace
    where workspace.id = target_workspace_id
      and workspace.status = 'active'
      and workspace.platform_status = 'active'
  ) then
    raise exception using message = 'WORKSPACE_NOT_FOUND';
  end if;
  if target_provider is null or length(btrim(target_provider)) = 0 then
    raise exception using message = 'INVALID_PROVIDER';
  end if;
  if target_environment not in ('sandbox', 'live') then
    raise exception using message = 'INVALID_ENVIRONMENT';
  end if;
  if target_provider_account_id is null or length(btrim(target_provider_account_id)) = 0 then
    raise exception using message = 'INVALID_PROVIDER_ACCOUNT';
  end if;
  if jsonb_typeof(coalesce(target_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using message = 'INVALID_METADATA';
  end if;

  insert into public.billing_provider_accounts (
    workspace_id, provider, environment, provider_account_id,
    provider_customer_id, metadata
  )
  values (
    target_workspace_id, btrim(target_provider), target_environment,
    btrim(target_provider_account_id), nullif(btrim(target_provider_customer_id), ''),
    coalesce(target_metadata, '{}'::jsonb)
  )
  on conflict (workspace_id, provider, environment) do update set
    provider_account_id = excluded.provider_account_id,
    provider_customer_id = excluded.provider_customer_id,
    metadata = excluded.metadata,
    updated_at = now()
  returning * into account;

  return query select account.id, account.workspace_id, account.provider,
    account.environment, account.provider_account_id, account.provider_customer_id,
    account.metadata, account.created_at, account.updated_at;
end;
$$;

create or replace function public.claim_billing_webhook_event(
  target_event_id uuid,
  target_lease_token uuid,
  target_lease_seconds integer default 300,
  target_allow_reclaim boolean default false,
  target_now timestamptz default now()
)
returns table (
  claimed boolean,
  event_id uuid,
  provider text,
  environment text,
  provider_event_id text,
  workspace_id uuid,
  status text,
  attempts integer,
  max_attempts integer,
  payload jsonb,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  event public.billing_webhook_events%rowtype;
begin
  if target_event_id is null or target_lease_token is null then
    raise exception using message = 'EVENT_AND_LEASE_TOKEN_REQUIRED';
  end if;
  if target_lease_seconds not between 1 and 3600 then
    raise exception using message = 'INVALID_LEASE_DURATION';
  end if;

  select * into event
  from public.billing_webhook_events
  where id = target_event_id
  for update;

  if event.id is null then
    return query select false, target_event_id, null::text, null::text, null::text,
      null::uuid, 'not_found'::text, 0, 0, '{}'::jsonb, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;
  if event.status in ('processed', 'ignored') then
    return query select false, event.id, event.provider, event.environment,
      event.provider_event_id, event.workspace_id, event.status, event.attempts,
      event.max_attempts, event.payload, event.lease_token, event.lease_until,
      event.next_attempt_at;
    return;
  end if;
  -- Repeating a claim with the same token is safe and does not consume another
  -- attempt. A different worker cannot take a live lease.
  if event.lease_token = target_lease_token and event.lease_until is not null
    and event.lease_until > target_now then
    return query select true, event.id, event.provider, event.environment,
      event.provider_event_id, event.workspace_id, event.status, event.attempts,
      event.max_attempts, event.payload, event.lease_token, event.lease_until,
      event.next_attempt_at;
    return;
  end if;
  if event.status = 'processing' and event.lease_until is not null
    and event.lease_until > target_now then
    return query select false, event.id, event.provider, event.environment,
      event.provider_event_id, event.workspace_id, event.status, event.attempts,
      event.max_attempts, event.payload, event.lease_token, event.lease_until,
      event.next_attempt_at;
    return;
  end if;
  if event.status = 'processing' and not target_allow_reclaim then
    return query select false, event.id, event.provider, event.environment,
      event.provider_event_id, event.workspace_id, event.status, event.attempts,
      event.max_attempts, event.payload, event.lease_token, event.lease_until,
      event.next_attempt_at;
    return;
  end if;
  if event.attempts >= event.max_attempts
    or (event.next_attempt_at is not null and event.next_attempt_at > target_now)
    or event.status not in ('received', 'failed', 'processing') then
    return query select false, event.id, event.provider, event.environment,
      event.provider_event_id, event.workspace_id, event.status, event.attempts,
      event.max_attempts, event.payload, event.lease_token, event.lease_until,
      event.next_attempt_at;
    return;
  end if;

  update public.billing_webhook_events
  set status = 'processing',
      attempts = event.attempts + 1,
      processing_started_at = target_now,
      lease_token = target_lease_token,
      lease_until = target_now + make_interval(secs => target_lease_seconds),
      next_attempt_at = null,
      last_error_code = null,
      last_error_message = null
  where id = event.id;

  return query select true, event.id, event.provider, event.environment,
    event.provider_event_id, event.workspace_id, 'processing'::text,
    event.attempts + 1, event.max_attempts, event.payload, target_lease_token,
    target_now + make_interval(secs => target_lease_seconds), null::timestamptz;
end;
$$;

create or replace function public.finalize_billing_webhook_event(
  target_event_id uuid,
  target_lease_token uuid,
  target_status text,
  target_error_code text default null,
  target_error_message text default null,
  target_next_attempt_at timestamptz default null,
  target_now timestamptz default now()
)
returns table (
  updated boolean,
  event_id uuid,
  status text,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  processed_at timestamptz,
  lease_token uuid,
  lease_until timestamptz
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  event public.billing_webhook_events%rowtype;
begin
  if target_status not in ('processed', 'ignored', 'failed') then
    raise exception using message = 'INVALID_EVENT_FINAL_STATUS';
  end if;
  if target_status = 'failed' and target_next_attempt_at is not null
    and target_next_attempt_at <= target_now then
    raise exception using message = 'RETRY_TIMESTAMP_MUST_BE_FUTURE';
  end if;

  select * into event
  from public.billing_webhook_events
  where id = target_event_id
  for update;
  if event.id is null then
    return query select false, target_event_id, 'not_found'::text, 0, 0,
      null::timestamptz, null::timestamptz, null::uuid, null::timestamptz;
    return;
  end if;
  if event.status in ('processed', 'ignored') then
    return query select false, event.id, event.status, event.attempts,
      event.max_attempts, event.next_attempt_at, event.processed_at,
      event.lease_token, event.lease_until;
    return;
  end if;
  if event.lease_token is distinct from target_lease_token then
    return query select false, event.id, event.status, event.attempts,
      event.max_attempts, event.next_attempt_at, event.processed_at,
      event.lease_token, event.lease_until;
    return;
  end if;

  update public.billing_webhook_events
  set status = target_status,
      processed_at = case when target_status in ('processed', 'ignored') then target_now else null end,
      processing_started_at = null,
      lease_token = null,
      lease_until = null,
      next_attempt_at = case when target_status = 'failed' then target_next_attempt_at else null end,
      last_error_code = case when target_status = 'failed' then target_error_code else null end,
      last_error_message = case when target_status = 'failed' then left(target_error_message, 2000) else null end
  where id = event.id;

  return query select true, event.id, target_status, event.attempts,
    event.max_attempts,
    case when target_status = 'failed' then target_next_attempt_at else null end,
    case when target_status in ('processed', 'ignored') then target_now else null end,
    null::uuid, null::timestamptz;
end;
$$;

create or replace function public.record_billing_mutation_transition(
  target_mutation_id uuid,
  target_workspace_id uuid,
  target_provider text,
  target_environment text,
  target_transition_key text,
  target_kind text,
  target_state text default 'pending',
  target_from_plan_key text default null,
  target_to_plan_key text default null,
  target_effective_at timestamptz default null,
  target_provider_reference text default null,
  target_outcome jsonb default '{}'::jsonb,
  target_max_attempts integer default 3
)
returns table (
  transition_id uuid,
  inserted boolean,
  mutation_id uuid,
  workspace_id uuid,
  provider text,
  environment text,
  transition_key text,
  kind text,
  state text,
  from_plan_key text,
  to_plan_key text,
  effective_at timestamptz,
  provider_reference text,
  outcome jsonb,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  last_error_message text
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  mutation public.billing_mutations%rowtype;
  transition public.billing_mutation_transitions%rowtype;
begin
  select * into mutation
  from public.billing_mutations
  where id = target_mutation_id
    and workspace_id = target_workspace_id;
  if mutation.id is null then
    raise exception using message = 'MUTATION_WORKSPACE_MISMATCH';
  end if;
  if target_provider is null or length(btrim(target_provider)) = 0 then
    raise exception using message = 'INVALID_PROVIDER';
  end if;
  if target_environment not in ('sandbox', 'live') then
    raise exception using message = 'INVALID_ENVIRONMENT';
  end if;
  if target_state not in ('pending', 'succeeded', 'failed', 'unknown') then
    raise exception using message = 'INVALID_TRANSITION_STATE';
  end if;
  if target_kind not in ('checkout', 'upgrade', 'downgrade', 'cancel', 'resume', 'renewal', 'recovery') then
    raise exception using message = 'INVALID_TRANSITION_KIND';
  end if;
  if target_max_attempts not between 1 and 20 then
    raise exception using message = 'INVALID_RETRY_POLICY';
  end if;
  if jsonb_typeof(coalesce(target_outcome, '{}'::jsonb)) <> 'object' then
    raise exception using message = 'INVALID_OUTCOME';
  end if;

  select * into transition
  from public.billing_mutation_transitions
  where provider = btrim(target_provider)
    and environment = target_environment
    and transition_key = btrim(target_transition_key)
  for update;
  if transition.id is not null then
    if transition.workspace_id <> target_workspace_id or transition.mutation_id <> target_mutation_id then
      raise exception using message = 'TRANSITION_KEY_CONFLICT';
    end if;
    return query select transition.id, false, transition.mutation_id, transition.workspace_id,
      transition.provider, transition.environment, transition.transition_key,
      transition.kind, transition.state, transition.from_plan_key, transition.to_plan_key,
      transition.effective_at, transition.provider_reference, transition.outcome,
      transition.attempts, transition.max_attempts, transition.next_attempt_at,
      transition.last_attempt_at, transition.last_error_code, transition.last_error_message;
    return;
  end if;

  insert into public.billing_mutation_transitions (
    mutation_id, workspace_id, provider, environment, transition_key, kind, state,
    from_plan_key, to_plan_key, effective_at, provider_reference, outcome, max_attempts
  )
  values (
    target_mutation_id, target_workspace_id, btrim(target_provider), target_environment,
    btrim(target_transition_key), target_kind, target_state, target_from_plan_key,
    target_to_plan_key, target_effective_at, target_provider_reference,
    coalesce(target_outcome, '{}'::jsonb), target_max_attempts
  )
  returning * into transition;

  return query select transition.id, true, transition.mutation_id, transition.workspace_id,
    transition.provider, transition.environment, transition.transition_key,
    transition.kind, transition.state, transition.from_plan_key, transition.to_plan_key,
    transition.effective_at, transition.provider_reference, transition.outcome,
    transition.attempts, transition.max_attempts, transition.next_attempt_at,
    transition.last_attempt_at, transition.last_error_code, transition.last_error_message;
end;
$$;

create or replace function public.update_billing_mutation_transition(
  target_transition_id uuid,
  target_state text,
  target_outcome jsonb default null,
  target_error_code text default null,
  target_error_message text default null,
  target_provider_reference text default null,
  target_expected_state text default null,
  target_next_attempt_at timestamptz default null,
  target_now timestamptz default now()
)
returns table (
  updated boolean,
  transition_id uuid,
  state text,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  provider_reference text,
  outcome jsonb,
  last_error_code text,
  last_error_message text
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  transition public.billing_mutation_transitions%rowtype;
begin
  if target_state not in ('pending', 'succeeded', 'failed', 'unknown') then
    raise exception using message = 'INVALID_TRANSITION_STATE';
  end if;
  select * into transition
  from public.billing_mutation_transitions
  where id = target_transition_id
  for update;
  if transition.id is null then
    return query select false, target_transition_id, 'not_found'::text, 0, 0,
      null::timestamptz, null::text, '{}'::jsonb, null::text, null::text;
    return;
  end if;
  if target_expected_state is not null and transition.state <> target_expected_state then
    return query select false, transition.id, transition.state, transition.attempts,
      transition.max_attempts, transition.next_attempt_at, transition.provider_reference,
      transition.outcome, transition.last_error_code, transition.last_error_message;
    return;
  end if;
  if transition.state = 'succeeded' and target_state <> 'succeeded' then
    return query select false, transition.id, transition.state, transition.attempts,
      transition.max_attempts, transition.next_attempt_at, transition.provider_reference,
      transition.outcome, transition.last_error_code, transition.last_error_message;
    return;
  end if;
  if transition.state = 'unknown' and target_state = 'failed' then
    raise exception using message = 'UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION';
  end if;
  if jsonb_typeof(coalesce(target_outcome, transition.outcome)) <> 'object' then
    raise exception using message = 'INVALID_OUTCOME';
  end if;

  update public.billing_mutation_transitions
  set state = target_state,
      outcome = coalesce(target_outcome, outcome),
      provider_reference = coalesce(target_provider_reference, provider_reference),
      last_error_code = case when target_state = 'failed' then target_error_code else null end,
      last_error_message = case when target_state = 'failed' then left(target_error_message, 2000) else null end,
      next_attempt_at = case when target_state in ('pending', 'unknown') then target_next_attempt_at else null end,
      last_attempt_at = target_now,
      attempts = attempts + 1,
      updated_at = target_now
  where id = transition.id;

  return query select true, transition.id, target_state, transition.attempts + 1,
    transition.max_attempts,
    case when target_state in ('pending', 'unknown') then target_next_attempt_at else null end,
    coalesce(target_provider_reference, transition.provider_reference),
    coalesce(target_outcome, transition.outcome),
    case when target_state = 'failed' then target_error_code else null end,
    case when target_state = 'failed' then left(target_error_message, 2000) else null end;
end;
$$;

create or replace function public.consume_billing_transition(
  target_workspace_id uuid,
  target_user_id uuid,
  target_transition_id uuid,
  target_now timestamptz default now()
)
returns table (
  consumed boolean,
  transition_id uuid,
  workspace_id uuid,
  user_id uuid,
  state text,
  kind text,
  effective_at timestamptz,
  outcome jsonb,
  consumed_at timestamptz
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  transition public.billing_mutation_transitions%rowtype;
  consumption public.billing_transition_consumptions%rowtype;
  inserted boolean := false;
begin
  if target_workspace_id is null or target_user_id is null or target_transition_id is null then
    raise exception using message = 'TRANSITION_CONSUMPTION_INPUT_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.workspace_members member
    join public.workspaces workspace on workspace.id = member.workspace_id
    where member.workspace_id = target_workspace_id
      and member.user_id = target_user_id
      and workspace.status = 'active'
      and workspace.platform_status = 'active'
  ) then
    raise exception using message = 'FORBIDDEN';
  end if;

  select * into transition
  from public.billing_mutation_transitions
  where id = target_transition_id
  for share;
  if transition.id is null then
    return query select false, target_transition_id, target_workspace_id, target_user_id,
      'not_found'::text, null::text, null::timestamptz, '{}'::jsonb, null::timestamptz;
    return;
  end if;
  if transition.workspace_id <> target_workspace_id then
    raise exception using message = 'WORKSPACE_MISMATCH';
  end if;
  if transition.state <> 'succeeded' then
    return query select false, transition.id, transition.workspace_id, target_user_id,
      transition.state, transition.kind, transition.effective_at, transition.outcome,
      null::timestamptz;
    return;
  end if;

  insert into public.billing_transition_consumptions (transition_id, workspace_id, user_id, consumed_at)
  values (transition.id, target_workspace_id, target_user_id, target_now)
  on conflict (workspace_id, user_id, transition_id) do nothing
  returning * into consumption;
  inserted := consumption.id is not null;

  if not inserted then
    select * into consumption
    from public.billing_transition_consumptions
    where workspace_id = target_workspace_id
      and user_id = target_user_id
      and transition_id = transition.id;
  end if;

  return query select inserted, transition.id, transition.workspace_id, target_user_id,
    transition.state, transition.kind, transition.effective_at, transition.outcome,
    consumption.consumed_at;
end;
$$;

alter table public.billing_provider_accounts enable row level security;
alter table public.billing_mutation_transitions enable row level security;
alter table public.billing_transition_consumptions enable row level security;

revoke all on table public.billing_provider_accounts,
  public.billing_mutation_transitions,
  public.billing_transition_consumptions
  from public, anon, authenticated;
revoke all on table public.billing_webhook_events from anon, authenticated;
grant all on table public.billing_provider_accounts,
  public.billing_mutation_transitions,
  public.billing_transition_consumptions,
  public.billing_webhook_events to service_role;

revoke all on function public.billing_provider_accounts_set_updated_at() from public, anon, authenticated;
revoke all on function public.guard_billing_mutation_transition() from public, anon, authenticated;
revoke all on function public.upsert_billing_provider_account(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_billing_webhook_event(uuid, uuid, integer, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_billing_webhook_event(uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.record_billing_mutation_transition(uuid, uuid, text, text, text, text, text, text, text, timestamptz, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.update_billing_mutation_transition(uuid, text, jsonb, text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_billing_transition(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_billing_provider_account(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.claim_billing_webhook_event(uuid, uuid, integer, boolean, timestamptz) to service_role;
grant execute on function public.finalize_billing_webhook_event(uuid, uuid, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.record_billing_mutation_transition(uuid, uuid, text, text, text, text, text, text, text, timestamptz, text, jsonb, integer) to service_role;
grant execute on function public.update_billing_mutation_transition(uuid, text, jsonb, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.consume_billing_transition(uuid, uuid, uuid, timestamptz) to service_role;
