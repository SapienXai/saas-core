-- ReserveVia consumer boundary for DataEngine's qualified restaurant leads.
-- The tables below are intentionally private and service-role-only. Public
-- restaurant/workspace rows are created only after an operator approves a
-- lead whose first-party email and local banner asset are both ready.

alter table public.restaurant_claim_profiles
  drop constraint if exists restaurant_claim_profiles_source_check;

alter table public.restaurant_claim_profiles
  add constraint restaurant_claim_profiles_source_check
  check (source in ('platform_manual', 'platform_excel', 'dataengine', 'self_service', 'legacy'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dataengine-import-assets',
  'dataengine-import-assets',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.dataengine_import_batches (
  id uuid primary key default gen_random_uuid(),
  external_batch_id text not null,
  contract_version text not null,
  source_run_id text,
  source_export_id text,
  source_scoring_version text,
  api_client_id uuid not null references public.api_clients(id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'received'
    check (status in ('received', 'needs_review', 'partially_approved', 'approved', 'rejected', 'published', 'failed')),
  total_leads integer not null default 0 check (total_leads >= 0),
  ready_leads integer not null default 0 check (ready_leads >= 0),
  needs_data_leads integer not null default 0 check (needs_data_leads >= 0),
  conflict_leads integer not null default 0 check (conflict_leads >= 0),
  approved_leads integer not null default 0 check (approved_leads >= 0),
  published_leads integer not null default 0 check (published_leads >= 0),
  rejected_leads integer not null default 0 check (rejected_leads >= 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  last_error text,
  constraint dataengine_import_batches_external_id_check check (length(btrim(external_batch_id)) between 1 and 200),
  constraint dataengine_import_batches_contract_check check (contract_version = 'reservevia.dataengine.leads.v1'),
  unique (external_batch_id)
);

alter table public.restaurant_claim_profiles
  add column if not exists dataengine_batch_id uuid references public.dataengine_import_batches(id) on delete set null;

create table if not exists public.dataengine_import_leads (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.dataengine_import_batches(id) on delete cascade,
  external_candidate_id text not null,
  source_place_id text,
  name text not null,
  city text,
  address text,
  official_website_url text,
  official_domain text,
  source_candidate_status text not null default 'new'
    check (source_candidate_status in ('new', 'shortlisted', 'contacted', 'excluded')),
  source_classification text,
  fit_score integer check (fit_score is null or fit_score between 0 and 100),
  data_confidence integer check (data_confidence is null or data_confidence between 0 and 100),
  source_scoring_version text,
  enrichment_status text,
  business_match text,
  readiness_status text not null default 'needs_data'
    check (readiness_status in ('ready', 'needs_data', 'needs_review', 'duplicate', 'rejected')),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected', 'published')),
  restaurant_id uuid references public.restaurants(id) on delete set null,
  duplicate_restaurant_id uuid references public.restaurants(id) on delete set null,
  conflict_reason text,
  business_contact_email text,
  normalized_business_contact_email text,
  staged_banner_path text,
  staged_banner_source_type text,
  staged_banner_source_url text,
  staged_banner_content_type text,
  staged_banner_width integer,
  staged_banner_height integer,
  source_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(source_payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  constraint dataengine_import_leads_candidate_id_check check (length(btrim(external_candidate_id)) between 1 and 200),
  unique (batch_id, external_candidate_id)
);

create table if not exists public.dataengine_import_evidence (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.dataengine_import_leads(id) on delete cascade,
  field text not null,
  value text not null,
  source_url text,
  source_type text,
  extraction_method text,
  confidence text,
  business_match text,
  scope text,
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dataengine_import_evidence_value_length check (length(value) <= 4000)
);

create table if not exists public.dataengine_import_identities (
  identity_key text primary key,
  first_lead_id uuid not null references public.dataengine_import_leads(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dataengine_import_identities_key_check check (length(btrim(identity_key)) between 1 and 500)
);

create or replace function public.claim_dataengine_import_identity(
  target_identity_key text,
  target_lead_id uuid,
  target_restaurant_id uuid default null
)
returns table (is_owner boolean, first_lead_id uuid, restaurant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.dataengine_import_identities (identity_key, first_lead_id, restaurant_id)
  values (btrim(target_identity_key), target_lead_id, target_restaurant_id)
  on conflict (identity_key) do nothing;

  return query
    select identity_row.first_lead_id = target_lead_id,
           identity_row.first_lead_id,
           identity_row.restaurant_id
      from public.dataengine_import_identities as identity_row
     where identity_row.identity_key = btrim(target_identity_key);
end;
$$;

create or replace function public.release_dataengine_import_identity(target_lead_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.dataengine_import_identities where first_lead_id = target_lead_id;
$$;

create table if not exists public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  reservation_id uuid references public.reservations(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  recipient_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'delivered', 'failed', 'bounced')),
  provider text not null default 'resend',
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists dataengine_import_batches_status_idx
  on public.dataengine_import_batches (status, created_at desc);
create index if not exists dataengine_import_batches_api_client_idx
  on public.dataengine_import_batches (api_client_id, created_at desc);
create index if not exists dataengine_import_leads_batch_status_idx
  on public.dataengine_import_leads (batch_id, readiness_status, review_status);
create index if not exists dataengine_import_leads_place_idx
  on public.dataengine_import_leads (source_place_id)
  where source_place_id is not null;
create index if not exists dataengine_import_leads_domain_idx
  on public.dataengine_import_leads (official_domain)
  where official_domain is not null;
create index if not exists dataengine_import_leads_restaurant_idx
  on public.dataengine_import_leads (restaurant_id)
  where restaurant_id is not null;
create index if not exists dataengine_import_evidence_lead_field_idx
  on public.dataengine_import_evidence (lead_id, field, confidence);
create index if not exists dataengine_import_identities_restaurant_idx
  on public.dataengine_import_identities (restaurant_id)
  where restaurant_id is not null;
create index if not exists email_delivery_events_status_idx
  on public.email_delivery_events (status, created_at desc);
create index if not exists email_delivery_events_reservation_idx
  on public.email_delivery_events (reservation_id, created_at desc);
create unique index if not exists email_delivery_events_provider_message_idx
  on public.email_delivery_events (provider, provider_message_id)
  where provider_message_id is not null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'dataengine_import_batches_set_updated_at') then
    create trigger dataengine_import_batches_set_updated_at
      before update on public.dataengine_import_batches
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'dataengine_import_leads_set_updated_at') then
    create trigger dataengine_import_leads_set_updated_at
      before update on public.dataengine_import_leads
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'email_delivery_events_set_updated_at') then
    create trigger email_delivery_events_set_updated_at
      before update on public.email_delivery_events
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'dataengine_import_identities_set_updated_at') then
    create trigger dataengine_import_identities_set_updated_at
      before update on public.dataengine_import_identities
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.dataengine_import_batches enable row level security;
alter table public.dataengine_import_leads enable row level security;
alter table public.dataengine_import_evidence enable row level security;
alter table public.dataengine_import_identities enable row level security;
alter table public.email_delivery_events enable row level security;

revoke all on public.dataengine_import_batches from public, anon, authenticated;
revoke all on public.dataengine_import_leads from public, anon, authenticated;
revoke all on public.dataengine_import_evidence from public, anon, authenticated;
revoke all on public.dataengine_import_identities from public, anon, authenticated;
revoke all on public.email_delivery_events from public, anon, authenticated;
grant all on public.dataengine_import_batches to service_role;
grant all on public.dataengine_import_leads to service_role;
grant all on public.dataengine_import_evidence to service_role;
grant all on public.dataengine_import_identities to service_role;
grant all on public.email_delivery_events to service_role;
revoke all on function public.claim_dataengine_import_identity(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_dataengine_import_identity(uuid) from public, anon, authenticated;
grant execute on function public.claim_dataengine_import_identity(text, uuid, uuid) to service_role;
grant execute on function public.release_dataengine_import_identity(uuid) to service_role;

comment on table public.dataengine_import_batches is 'Private, versioned, idempotent DataEngine import batches awaiting ReserveVia review.';
comment on table public.dataengine_import_leads is 'Private DataEngine candidate snapshots. Source scores, Google identifiers, contacts, and evidence never form public catalog fields.';
comment on table public.dataengine_import_evidence is 'Private first-party enrichment evidence used for contact validation and operator review.';
comment on table public.dataengine_import_identities is 'Private cross-batch identity reservations that make DataEngine imports duplicate-safe under concurrent delivery.';
comment on table public.email_delivery_events is 'Provider delivery lifecycle for transactional emails, including unclaimed restaurant reservation notifications.';

notify pgrst, 'reload schema';
