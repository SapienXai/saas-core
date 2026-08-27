-- Production hardening for the DataEngine -> ReserveVia private import saga.
-- This migration is additive and keeps reservevia.dataengine.leads.v1 stable.

alter table public.dataengine_import_batches
  add column if not exists ingest_attempt_count integer not null default 0,
  add column if not exists ingest_phase text not null default 'received',
  add column if not exists ingest_started_at timestamptz,
  add column if not exists ingest_completed_at timestamptz,
  add column if not exists ingest_lease_token uuid,
  add column if not exists ingest_lease_until timestamptz,
  add column if not exists last_ingest_error text;

alter table public.dataengine_import_batches
  drop constraint if exists dataengine_import_batches_status_check;
alter table public.dataengine_import_batches
  add constraint dataengine_import_batches_status_check
  check (status in ('received', 'processing', 'needs_review', 'partially_approved', 'approved', 'publishing', 'partially_published', 'rejected', 'published', 'failed', 'recovery_required'));

alter table public.dataengine_import_leads
  add column if not exists identity_key text,
  add column if not exists identity_status text not null default 'reserved',
  add column if not exists identity_claimed_at timestamptz,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null,
  add column if not exists restaurant_slug text,
  add column if not exists publish_status text not null default 'pending',
  add column if not exists publish_phase text not null default 'not_started',
  add column if not exists publish_attempt_count integer not null default 0,
  add column if not exists publish_started_at timestamptz,
  add column if not exists publish_completed_at timestamptz,
  add column if not exists publish_lease_token uuid,
  add column if not exists publish_lease_until timestamptz,
  add column if not exists publish_error text,
  add column if not exists banner_status text not null default 'pending',
  add column if not exists banner_attempt_count integer not null default 0,
  add column if not exists banner_error text,
  add column if not exists official_website_verified_at timestamptz,
  add column if not exists public_banner_path text,
  add column if not exists public_banner_url text,
  add column if not exists public_banner_published_at timestamptz,
  add column if not exists manual_override_reason text,
  add column if not exists manual_override_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists manual_override_at timestamptz,
  add column if not exists claimed_update_suggestion jsonb not null default '{}'::jsonb,
  add column if not exists claimed_conflict boolean not null default false;

alter table public.dataengine_import_leads
  drop constraint if exists dataengine_import_leads_identity_status_check;
alter table public.dataengine_import_leads
  add constraint dataengine_import_leads_identity_status_check
  check (identity_status in ('reserved', 'owner', 'linked', 'duplicate', 'released'));
alter table public.dataengine_import_leads
  drop constraint if exists dataengine_import_leads_publish_status_check;
alter table public.dataengine_import_leads
  add constraint dataengine_import_leads_publish_status_check
  check (publish_status in ('pending', 'publishing', 'published', 'failed', 'blocked', 'skipped'));
alter table public.dataengine_import_leads
  drop constraint if exists dataengine_import_leads_banner_status_check;
alter table public.dataengine_import_leads
  add constraint dataengine_import_leads_banner_status_check
  check (banner_status in ('pending', 'staged', 'failed'));

alter table public.restaurant_claim_profiles
  add column if not exists business_email_delivery_status text not null default 'healthy',
  add column if not exists business_email_last_error text,
  add column if not exists business_email_paused_at timestamptz;
alter table public.restaurant_claim_profiles
  drop constraint if exists restaurant_claim_profiles_business_email_delivery_status_check;
alter table public.restaurant_claim_profiles
  add constraint restaurant_claim_profiles_business_email_delivery_status_check
  check (business_email_delivery_status in ('healthy', 'pending', 'hard_bounce', 'paused'));

alter table public.email_delivery_events
  drop constraint if exists email_delivery_events_status_check;
alter table public.email_delivery_events
  add constraint email_delivery_events_status_check
  check (status in ('pending', 'sending', 'sent', 'delivered', 'retrying', 'failed', 'bounced', 'paused'));
alter table public.email_delivery_events
  add column if not exists dedupe_key text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists last_provider_event_at timestamptz;

create unique index if not exists email_delivery_events_dedupe_idx
  on public.email_delivery_events (dedupe_key)
  where dedupe_key is not null;
update public.dataengine_import_evidence set source_url = '' where source_url is null;
delete from public.dataengine_import_evidence as duplicate_row
 using public.dataengine_import_evidence as retained_row
 where duplicate_row.id > retained_row.id
   and duplicate_row.lead_id = retained_row.lead_id
   and duplicate_row.field = retained_row.field
   and duplicate_row.value = retained_row.value
   and duplicate_row.source_url = retained_row.source_url;
create unique index if not exists dataengine_import_evidence_unique_idx
  on public.dataengine_import_evidence (lead_id, field, value, source_url);

create table if not exists public.email_provider_webhook_events (
  provider_event_id text primary key,
  provider text not null default 'resend',
  provider_message_id text not null,
  event_type text not null,
  event_at timestamptz,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now()
);

create table if not exists public.email_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_event_id uuid not null references public.email_delivery_events(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('sending', 'sent', 'retrying', 'failed')),
  provider_message_id text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (delivery_event_id, attempt_number)
);

create index if not exists dataengine_import_leads_publish_idx
  on public.dataengine_import_leads (publish_status, publish_lease_until, updated_at desc);
create index if not exists dataengine_import_leads_workspace_idx
  on public.dataengine_import_leads (workspace_id)
  where workspace_id is not null;
create index if not exists dataengine_import_leads_identity_idx
  on public.dataengine_import_leads (identity_key)
  where identity_key is not null;
create index if not exists email_delivery_events_outbox_idx
  on public.email_delivery_events (status, next_attempt_at, lease_until, created_at)
  where status in ('pending', 'retrying', 'sending');
create index if not exists email_delivery_attempts_event_idx on public.email_delivery_attempts (delivery_event_id, attempt_number desc);

create or replace function public.claim_dataengine_import_batch(
  target_external_batch_id text,
  target_contract_version text,
  target_api_client_id uuid,
  target_request_hash text,
  target_total_leads integer,
  target_lease_token uuid
)
returns table (batch_id uuid, batch_status text, stored_request_hash text, lease_acquired boolean, replayable boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_row public.dataengine_import_batches%rowtype;
begin
  if target_contract_version <> 'reservevia.dataengine.leads.v1' then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_UNSUPPORTED';
  end if;
  insert into public.dataengine_import_batches (
    external_batch_id, contract_version, api_client_id, request_hash, total_leads,
    status, ingest_phase, ingest_attempt_count, ingest_lease_token, ingest_lease_until, ingest_started_at
  ) values (
    btrim(target_external_batch_id), target_contract_version, target_api_client_id, lower(target_request_hash), target_total_leads,
    'processing', 'leads', 1, target_lease_token, now() + interval '10 minutes', now()
  ) on conflict (external_batch_id) do nothing;

  select * into batch_row
    from public.dataengine_import_batches
   where external_batch_id = btrim(target_external_batch_id)
   for update;

  if batch_row.request_hash <> lower(target_request_hash) then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;

  if batch_row.status in ('needs_review', 'partially_approved', 'approved', 'publishing', 'partially_published', 'rejected', 'published') then
    return query select batch_row.id, batch_row.status, batch_row.request_hash, false, true;
    return;
  end if;

  if batch_row.status = 'processing'
     and batch_row.ingest_lease_until is not null
     and batch_row.ingest_lease_until > now()
     and batch_row.ingest_lease_token is distinct from target_lease_token then
    return query select batch_row.id, batch_row.status, batch_row.request_hash, false, false;
    return;
  end if;

  update public.dataengine_import_batches
     set status = 'processing',
         ingest_phase = case when batch_row.status in ('failed', 'recovery_required') then 'leads' else coalesce(nullif(ingest_phase, ''), 'leads') end,
         ingest_attempt_count = ingest_attempt_count + 1,
         ingest_lease_token = target_lease_token,
         ingest_lease_until = now() + interval '10 minutes',
         ingest_started_at = coalesce(ingest_started_at, now()),
         last_ingest_error = null,
         last_error = null,
         updated_at = now()
   where id = batch_row.id;

  return query select batch_row.id, 'processing'::text, batch_row.request_hash, true, false;
end;
$$;

create or replace function public.claim_dataengine_lead_publish(
  target_lead_id uuid,
  target_lease_token uuid
)
returns table (claimed boolean, current_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_row public.dataengine_import_leads%rowtype;
begin
  select * into lead_row from public.dataengine_import_leads where id = target_lead_id for update;
  if lead_row.id is null then return query select false, 'missing'::text; return; end if;
  if lead_row.publish_status = 'published' then return query select false, 'published'::text; return; end if;
  if lead_row.claimed_conflict or (lead_row.publish_status = 'blocked') then return query select false, 'blocked'::text; return; end if;
  if lead_row.publish_status = 'publishing' and lead_row.publish_lease_until > now() and lead_row.publish_lease_token is distinct from target_lease_token then
    return query select false, 'publishing'::text; return;
  end if;
  update public.dataengine_import_leads
     set publish_status = 'publishing',
         publish_phase = 'tenant',
         publish_attempt_count = publish_attempt_count + 1,
         publish_started_at = now(),
         publish_lease_token = target_lease_token,
         publish_lease_until = now() + interval '15 minutes',
         publish_error = null,
         review_status = 'approved',
         updated_at = now()
   where id = target_lead_id;
  return query select true, 'publishing'::text;
end;
$$;

create or replace function public.provision_dataengine_lead_tenant(
  target_lead_id uuid,
  target_batch_id uuid,
  target_restaurant_name text,
  target_business_contact_email text,
  target_official_website_url text,
  target_official_domain text,
  target_profile jsonb
)
returns table (workspace_id uuid, restaurant_id uuid, workspace_slug text, restaurant_slug text)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  lead_row public.dataengine_import_leads%rowtype;
  provisioned record;
begin
  select * into lead_row from public.dataengine_import_leads where id = target_lead_id and batch_id = target_batch_id for update;
  if lead_row.id is null then raise exception using errcode = 'P0001', message = 'DATAENGINE_LEAD_NOT_FOUND'; end if;
  if lead_row.restaurant_id is not null and lead_row.workspace_id is not null then
    return query select lead_row.workspace_id, lead_row.restaurant_id, (select slug from public.workspaces where id = lead_row.workspace_id), lead_row.restaurant_slug;
    return;
  end if;

  select * into provisioned from private.provision_restaurant_workspace(
    target_restaurant_name, target_restaurant_name || ' workspace', null, null, null,
    'unpublished', 'unclaimed', 'platform_manual', target_business_contact_email,
    target_official_website_url, target_official_domain, null, target_profile
  );

  update public.restaurant_claim_profiles
     set source = 'dataengine', dataengine_batch_id = target_batch_id,
         business_contact_email = lower(btrim(target_business_contact_email)),
         normalized_business_contact_email = lower(btrim(target_business_contact_email)),
         official_website_url = nullif(btrim(target_official_website_url), ''),
         official_domain = nullif(lower(btrim(target_official_domain)), ''), updated_at = now()
   where restaurant_id = provisioned.restaurant_id;

  update public.restaurants
     set official_website_url = nullif(btrim(target_official_website_url), '')
   where id = provisioned.restaurant_id;

  update public.dataengine_import_leads
     set restaurant_id = provisioned.restaurant_id,
         workspace_id = provisioned.workspace_id,
         restaurant_slug = provisioned.restaurant_slug,
         publish_phase = 'tenant_provisioned',
         updated_at = now()
   where id = target_lead_id;

  update public.dataengine_import_identities
     set restaurant_id = provisioned.restaurant_id, updated_at = now()
   where first_lead_id = target_lead_id;

  return query select provisioned.workspace_id, provisioned.restaurant_id, provisioned.workspace_slug, provisioned.restaurant_slug;
end;
$$;

create or replace function public.finalize_dataengine_lead_publication(
  target_lead_id uuid,
  target_restaurant_id uuid,
  target_public_banner_url text,
  target_profile jsonb
)
returns table (published boolean, final_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_row public.restaurant_claim_profiles%rowtype;
begin
  select * into claim_row from public.restaurant_claim_profiles where restaurant_id = target_restaurant_id for update;
  if claim_row.restaurant_id is null then return query select false, 'missing_claim_profile'::text; return; end if;
  if claim_row.ownership_status = 'claimed' then
    update public.dataengine_import_leads
       set claimed_conflict = true,
           publish_status = 'blocked',
           publish_phase = 'claimed_conflict',
           conflict_reason = 'Restaurant was claimed before DataEngine publication completed.',
           claimed_update_suggestion = coalesce(source_payload, '{}'::jsonb),
           updated_at = now()
     where id = target_lead_id;
    return query select false, 'claimed_conflict'::text;
    return;
  end if;

  update public.restaurants
     set description = nullif(target_profile->>'description', ''),
         cuisine = nullif(target_profile->>'cuisine', ''),
         hours = nullif(target_profile->>'hours', ''),
         location = nullif(target_profile->>'location', ''),
         phone = nullif(target_profile->>'phone', ''),
         menu_url = nullif(target_profile->>'menu_url', ''),
         official_website_url = nullif(target_profile->>'official_website_url', ''),
         social_links = coalesce(target_profile->'social_links', social_links),
         primary_image_url = target_public_banner_url,
         status = 'published'
   where id = target_restaurant_id;

  update public.dataengine_import_leads
     set review_status = 'published', readiness_status = 'ready', publish_status = 'published',
         publish_phase = 'completed', publish_completed_at = now(), publish_lease_token = null,
         publish_lease_until = null, restaurant_id = target_restaurant_id,
         conflict_reason = null, reviewed_at = coalesce(reviewed_at, now()), published_at = now(), updated_at = now()
   where id = target_lead_id;
  update public.dataengine_import_identities set restaurant_id = target_restaurant_id, updated_at = now() where first_lead_id = target_lead_id;
  return query select true, 'published'::text;
end;
$$;

create or replace function public.link_dataengine_identity_to_restaurant(target_lead_id uuid, target_restaurant_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.dataengine_import_identities
     set restaurant_id = target_restaurant_id, updated_at = now()
   where first_lead_id = target_lead_id;
$$;

create or replace function public.release_dataengine_import_identity(target_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.dataengine_import_identities where first_lead_id = target_lead_id;
  update public.dataengine_import_leads set identity_status = 'released', updated_at = now() where id = target_lead_id;
end;
$$;

create or replace function public.apply_email_delivery_webhook(
  target_provider_event_id text,
  target_provider_message_id text,
  target_event_type text,
  target_event_at timestamptz,
  target_error text,
  target_pause_booking boolean,
  target_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
  event_row public.email_delivery_events%rowtype;
  incoming_status text;
  current_rank integer;
  incoming_rank integer;
begin
  insert into public.email_provider_webhook_events (provider_event_id, provider_message_id, event_type, event_at, payload)
  values (target_provider_event_id, target_provider_message_id, target_event_type, target_event_at, coalesce(target_payload, '{}'::jsonb))
  on conflict (provider_event_id) do nothing;
  get diagnostics inserted_count = row_count;
  -- A duplicate provider event is still replayed against the delivery row.
  -- This closes the race where the provider webhook arrives before the send
  -- response has persisted its provider message id. State ranking below keeps
  -- the replay monotonic and harmless.

  incoming_status := case target_event_type
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.failed' then 'failed'
    else null end;
  if incoming_status is null then return true; end if;

  select * into event_row from public.email_delivery_events
   where provider = 'resend' and provider_message_id = target_provider_message_id
   for update;
  if event_row.id is null then return true; end if;

  current_rank := case event_row.status when 'bounced' then 50 when 'failed' then 40 when 'delivered' then 30 when 'sent' then 20 else 10 end;
  incoming_rank := case incoming_status when 'bounced' then 50 when 'failed' then 40 when 'delivered' then 30 else 20 end;
  if incoming_rank >= current_rank then
    update public.email_delivery_events
       set status = incoming_status,
           delivered_at = case when incoming_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
           failed_at = case when incoming_status in ('failed', 'bounced') then coalesce(failed_at, now()) else failed_at end,
           last_error = case when incoming_status in ('failed', 'bounced') then left(coalesce(target_error, incoming_status), 2000) else last_error end,
           last_provider_event_at = coalesce(target_event_at, now()),
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_provider_event', target_event_type)
     where id = event_row.id;
  end if;

  if target_pause_booking and incoming_status in ('failed', 'bounced') then
    update public.restaurant_claim_profiles
       set business_email_delivery_status = 'hard_bounce',
           business_email_last_error = left(coalesce(target_error, incoming_status), 2000),
           business_email_paused_at = coalesce(business_email_paused_at, now()), updated_at = now()
     where restaurant_id = event_row.restaurant_id
       and source = 'dataengine'
       and ownership_status in ('unclaimed', 'claim_pending');
  end if;
  return true;
end;
$$;

create or replace function public.claim_email_delivery_event(target_event_id uuid, target_lease_token uuid)
returns table (claimed boolean, payload jsonb, attempt_count integer, max_attempts integer, current_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.email_delivery_events%rowtype;
begin
  select * into event_row from public.email_delivery_events where id = target_event_id for update;
  if event_row.id is null then return query select false, '{}'::jsonb, 0, 0, 'missing'::text; return; end if;
  if event_row.status in ('sent', 'delivered', 'bounced', 'paused') then return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return; end if;
  if event_row.status = 'sending' and event_row.lease_until > now() and event_row.lease_token is distinct from target_lease_token then
    return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return;
  end if;
  if event_row.next_attempt_at is not null and event_row.next_attempt_at > now() then
    return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return;
  end if;
  if event_row.attempt_count >= event_row.max_attempts then
    update public.email_delivery_events set status = 'failed', failed_at = coalesce(failed_at, now()), updated_at = now() where id = target_event_id;
    return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, 'failed'::text; return;
  end if;
  update public.email_delivery_events
     set status = 'sending', attempt_count = attempt_count + 1, last_attempt_at = now(), lease_token = target_lease_token, lease_until = now() + interval '5 minutes', updated_at = now()
   where id = target_event_id;
  insert into public.email_delivery_attempts (delivery_event_id, attempt_number, status)
  values (target_event_id, event_row.attempt_count + 1, 'sending')
  on conflict (delivery_event_id, attempt_number) do nothing;
  return query select true, event_row.payload, event_row.attempt_count + 1, event_row.max_attempts, 'sending'::text;
end;
$$;

alter table public.email_provider_webhook_events enable row level security;
revoke all on public.email_provider_webhook_events from public, anon, authenticated;
grant all on public.email_provider_webhook_events to service_role;
alter table public.email_delivery_attempts enable row level security;
revoke all on public.email_delivery_attempts from public, anon, authenticated;
grant all on public.email_delivery_attempts to service_role;

revoke all on function public.claim_dataengine_import_batch(text, text, uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.claim_dataengine_lead_publish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.provision_dataengine_lead_tenant(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_dataengine_lead_publication(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.link_dataengine_identity_to_restaurant(uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_email_delivery_webhook(text, text, text, timestamptz, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.claim_email_delivery_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_dataengine_import_batch(text, text, uuid, text, integer, uuid) to service_role;
grant execute on function public.claim_dataengine_lead_publish(uuid, uuid) to service_role;
grant execute on function public.provision_dataengine_lead_tenant(uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.finalize_dataengine_lead_publication(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.link_dataengine_identity_to_restaurant(uuid, uuid) to service_role;
grant execute on function public.apply_email_delivery_webhook(text, text, text, timestamptz, text, boolean, jsonb) to service_role;
grant execute on function public.claim_email_delivery_event(uuid, uuid) to service_role;

comment on column public.dataengine_import_leads.claimed_update_suggestion is 'Private post-claim DataEngine snapshot suggestion. Never applied automatically.';
comment on column public.dataengine_import_leads.public_banner_path is 'Idempotent public asset projection path for the DataEngine publish saga.';
comment on table public.email_provider_webhook_events is 'Private idempotency ledger for out-of-order provider delivery events.';

notify pgrst, 'reload schema';
