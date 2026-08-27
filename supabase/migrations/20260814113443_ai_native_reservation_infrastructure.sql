-- AI-native reservation infrastructure.
-- restaurants.id remains the immutable provider identity. These additions are
-- additive and keep the existing human booking schema authoritative.

alter table public.restaurants
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists address_locality text,
  add column if not exists address_region text,
  add column if not exists address_postal_code text,
  add column if not exists address_country text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists official_website_url text,
  add column if not exists required_guest_fields text[] not null default '{name,phone}',
  add column if not exists optional_guest_fields text[] not null default '{email,notes}';

-- The claim profile already owns the imported official website value. Copy it
-- into the public restaurant projection only when the new projection is empty.
-- No private contact field is copied.
update public.restaurants restaurant
set official_website_url = claim_profile.official_website_url,
    updated_at = now()
from public.restaurant_claim_profiles claim_profile
where claim_profile.restaurant_id = restaurant.id
  and restaurant.official_website_url is null
  and claim_profile.official_website_url is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_latitude_check' and conrelid = 'public.restaurants'::regclass) then
    alter table public.restaurants add constraint restaurants_latitude_check check (latitude is null or latitude between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_longitude_check' and conrelid = 'public.restaurants'::regclass) then
    alter table public.restaurants add constraint restaurants_longitude_check check (longitude is null or longitude between -180 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_coordinate_pair_check' and conrelid = 'public.restaurants'::regclass) then
    alter table public.restaurants add constraint restaurants_coordinate_pair_check check ((latitude is null) = (longitude is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_guest_fields_check' and conrelid = 'public.restaurants'::regclass) then
    alter table public.restaurants add constraint restaurants_guest_fields_check check (
      required_guest_fields <@ array['name', 'phone', 'email', 'notes', 'dietary_requirements']::text[]
      and optional_guest_fields <@ array['name', 'phone', 'email', 'notes', 'dietary_requirements']::text[]
    );
  end if;
end $$;

create index if not exists restaurants_public_identity_idx
  on public.restaurants (id, status, platform_status, reservation_enabled);
create index if not exists restaurants_public_location_idx
  on public.restaurants (address_country, address_locality, latitude, longitude);

alter table public.reservations
  add column if not exists source_channel text not null default 'human_web',
  add column if not exists source_client_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_source_channel_check' and conrelid = 'public.reservations'::regclass) then
    alter table public.reservations add constraint reservations_source_channel_check check (source_channel in ('human_web', 'agent_rest', 'mcp', 'openai', 'future_partner'));
  end if;
end $$;

create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credential_hash text not null unique,
  status text not null default 'active',
  scopes text[] not null default '{restaurants:read,availability:read}',
  rate_limit_profile text not null default 'standard',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint api_clients_status_check check (status in ('active', 'revoked')),
  constraint api_clients_rate_limit_profile_check check (rate_limit_profile in ('standard', 'partner', 'internal'))
);

create index if not exists api_clients_status_idx on public.api_clients (status, created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_source_client_id_fkey' and conrelid = 'public.reservations'::regclass) then
    alter table public.reservations
      add constraint reservations_source_client_id_fkey foreign key (source_client_id) references public.api_clients(id) on delete set null;
  end if;
end $$;

create table if not exists public.reservation_holds (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reservation_area_id uuid references public.reservation_areas(id) on delete set null,
  reservation_date date not null,
  reservation_time time not null,
  party_size integer not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  api_client_id uuid references public.api_clients(id) on delete set null,
  constraint reservation_holds_party_size_check check (party_size > 0),
  constraint reservation_holds_status_check check (status in ('active', 'converted', 'expired', 'cancelled')),
  constraint reservation_holds_expiry_check check (expires_at > created_at)
);

create index if not exists reservation_holds_lookup_idx
  on public.reservation_holds (restaurant_id, reservation_date, reservation_time, reservation_area_id, status, expires_at);
create index if not exists reservation_holds_expiry_idx
  on public.reservation_holds (status, expires_at);
create index if not exists reservation_holds_client_idx
  on public.reservation_holds (api_client_id, created_at desc);

create table if not exists public.reservation_customer_management_tokens (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token_hash text not null unique,
  scopes text[] not null default '{reservation:read,reservation:manage}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reservation_customer_management_tokens_lookup_idx
  on public.reservation_customer_management_tokens (reservation_id, expires_at desc)
  where revoked_at is null;

create table if not exists public.reservation_operation_idempotency (
  id uuid primary key default gen_random_uuid(),
  api_client_id uuid not null references public.api_clients(id) on delete cascade,
  operation_kind text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer not null,
  response_json jsonb not null,
  resource_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint reservation_operation_idempotency_key_length check (length(idempotency_key) between 8 and 200),
  constraint reservation_operation_idempotency_status_check check (response_status between 200 and 599),
  constraint reservation_operation_idempotency_unique_key unique (api_client_id, operation_kind, idempotency_key)
);

create index if not exists reservation_operation_idempotency_expiry_idx
  on public.reservation_operation_idempotency (expires_at);

create table if not exists public.ai_business_feed_state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 1,
  last_changed_at timestamptz not null default now()
);

insert into public.ai_business_feed_state (singleton) values (true)
on conflict (singleton) do nothing;

create or replace function public.bump_ai_business_feed_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_business_feed_state
  set revision = revision + 1, last_changed_at = now()
  where singleton = true;
  return null;
end;
$$;

drop trigger if exists restaurants_bump_ai_business_feed_revision on public.restaurants;
create trigger restaurants_bump_ai_business_feed_revision
  after insert or update or delete on public.restaurants
  for each statement execute function public.bump_ai_business_feed_revision();

create or replace function public.create_reservation_hold(
  p_restaurant_id uuid,
  p_reservation_area_id uuid,
  p_reservation_date date,
  p_reservation_time time,
  p_party_size integer,
  p_ttl_seconds integer,
  p_api_client_id uuid
)
returns table (hold_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  area_capacity integer;
  reservation_count integer;
  hold_count integer;
  new_hold public.reservation_holds%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    concat(p_restaurant_id::text, ':', coalesce(p_reservation_area_id::text, 'default'), ':', p_reservation_date::text, ':', p_reservation_time::text),
    0
  ));

  update public.reservation_holds as hold
  set status = 'expired', updated_at = now()
  where hold.status = 'active' and hold.expires_at <= now();

  select area.max_concurrent_reservations
  into area_capacity
  from public.reservation_areas area
  where area.id = p_reservation_area_id
    and area.restaurant_id = p_restaurant_id
    and area.is_active = true;

  if p_reservation_area_id is null or area_capacity is null then
    -- A null capacity is an existing restaurant configuration, not an
    -- invitation to invent capacity. The caller can still book directly
    -- through the established human flow, but an agent hold is unavailable.
    raise exception using errcode = 'P0001', message = 'HOLD_UNAVAILABLE';
  end if;

  select count(*) into reservation_count
  from public.reservations reservation
  where reservation.restaurant_id = p_restaurant_id
    and reservation.reservation_area_id is not distinct from p_reservation_area_id
    and reservation.reservation_date = p_reservation_date
    and reservation.reservation_time = p_reservation_time
    and reservation.status in ('pending', 'confirmed');

  select count(*) into hold_count
  from public.reservation_holds hold
  where hold.restaurant_id = p_restaurant_id
    and hold.reservation_area_id is not distinct from p_reservation_area_id
    and hold.reservation_date = p_reservation_date
    and hold.reservation_time = p_reservation_time
    and hold.status = 'active'
    and hold.expires_at > now();

  if reservation_count + hold_count >= area_capacity then
    raise exception using errcode = 'P0001', message = 'HOLD_SLOT_UNAVAILABLE';
  end if;

  insert into public.reservation_holds (
    restaurant_id, reservation_area_id, reservation_date, reservation_time,
    party_size, expires_at, api_client_id
  ) values (
    p_restaurant_id, p_reservation_area_id, p_reservation_date, p_reservation_time,
    p_party_size, now() + make_interval(secs => greatest(30, least(p_ttl_seconds, 600))), p_api_client_id
  ) returning * into new_hold;

  return query select new_hold.id, new_hold.expires_at;
end;
$$;

create or replace function public.convert_reservation_hold(
  p_hold_id uuid,
  p_api_client_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_special_requests text,
  p_reservation_type text,
  p_source_channel text
)
returns table (reservation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_row public.reservation_holds%rowtype;
  inserted_id uuid;
begin
  select * into hold_row
  from public.reservation_holds
  where id = p_hold_id
    and api_client_id is not distinct from p_api_client_id
  for update;

  if hold_row.id is null then
    raise exception using errcode = 'P0001', message = 'HOLD_NOT_FOUND';
  end if;
  if hold_row.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'HOLD_NOT_FOUND';
  end if;
  if hold_row.expires_at <= now() then
    update public.reservation_holds set status = 'expired', updated_at = now() where id = hold_row.id;
    raise exception using errcode = 'P0001', message = 'HOLD_EXPIRED';
  end if;

  insert into public.reservations (
    restaurant_id, reservation_area_id, customer_name, customer_phone, customer_email,
    party_size, reservation_date, reservation_time, special_requests,
    reservation_type, status, booking_source, booked_by_label, source_channel, source_client_id
  ) values (
    hold_row.restaurant_id, hold_row.reservation_area_id, p_customer_name, p_customer_phone, p_customer_email,
    hold_row.party_size, hold_row.reservation_date, hold_row.reservation_time, p_special_requests,
    p_reservation_type, 'pending', p_source_channel, 'AI agent', p_source_channel, p_api_client_id
  ) returning id into inserted_id;

  update public.reservation_holds
  set status = 'converted', updated_at = now()
  where id = hold_row.id;

  return query select inserted_id;
end;
$$;

revoke all on function public.create_reservation_hold(uuid, uuid, date, time, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.convert_reservation_hold(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_reservation_hold(uuid, uuid, date, time, integer, integer, uuid) to service_role;
grant execute on function public.convert_reservation_hold(uuid, uuid, text, text, text, text, text, text) to service_role;

create or replace function public.cleanup_reservation_infrastructure()
returns table (expired_holds bigint, deleted_idempotency_records bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count bigint;
  deleted_count bigint;
begin
  update public.reservation_holds
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();
  get diagnostics expired_count = row_count;

  delete from public.reservation_operation_idempotency
  where expires_at <= now() - interval '1 hour';
  get diagnostics deleted_count = row_count;
  return query select expired_count, deleted_count;
end;
$$;

revoke all on function public.cleanup_reservation_infrastructure() from public, anon, authenticated;
grant execute on function public.cleanup_reservation_infrastructure() to service_role;

drop trigger if exists reservation_holds_set_updated_at on public.reservation_holds;
create trigger reservation_holds_set_updated_at
  before update on public.reservation_holds
  for each row execute function public.set_updated_at();

alter table public.api_clients enable row level security;
alter table public.reservation_holds enable row level security;
alter table public.reservation_operation_idempotency enable row level security;
alter table public.ai_business_feed_state enable row level security;
alter table public.reservation_customer_management_tokens enable row level security;

revoke all on public.api_clients from public, anon, authenticated;
revoke all on public.reservation_holds from public, anon, authenticated;
revoke all on public.reservation_operation_idempotency from public, anon, authenticated;
revoke all on public.ai_business_feed_state from public, anon, authenticated;
revoke all on public.reservation_customer_management_tokens from public, anon, authenticated;
grant all on public.api_clients to service_role;
grant all on public.reservation_holds to service_role;
grant all on public.reservation_operation_idempotency to service_role;
grant all on public.ai_business_feed_state to service_role;
grant all on public.reservation_customer_management_tokens to service_role;

-- The server-side Supabase client uses the trusted service_role for domain
-- services. Keep that contract explicit after a clean local or production
-- migration replay. This does not grant anything to anon/authenticated and
-- does not bypass the RLS policies used by those roles.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;

-- Keep the table privileges required by the existing RLS policies explicit.
-- RLS remains the tenant boundary; these grants only allow PostgREST to
-- evaluate the policies on the established human-booking tables.
grant all on public.admin_profiles to anon, authenticated;
grant all on public.admin_push_subscriptions to anon, authenticated;
grant all on public.notification_settings to anon, authenticated;
grant all on public.reservation_areas to anon, authenticated;
grant all on public.reservations to anon, authenticated;
grant all on public.restaurant_media to anon, authenticated;
grant all on public.restaurants to anon, authenticated;
grant select on public.restaurant_domains to anon, authenticated;
grant select on public.workspace_invitation_restaurants to anon, authenticated;
grant select on public.workspace_invitations to anon, authenticated;
grant select on public.workspace_member_restaurants to anon, authenticated;
grant select on public.workspace_members to anon, authenticated;
grant all on public.workspace_push_subscriptions to anon, authenticated;
grant all on public.workspace_pwa_settings to anon, authenticated;
grant select on public.workspace_subscriptions to authenticated;
grant select on public.workspace_usage_periods to authenticated;
grant all on public.workspaces to anon, authenticated;

comment on column public.restaurants.id is 'Immutable ReserveVia provider identity. Safe to expose in public machine contracts.';
comment on column public.restaurants.slug is 'Mutable human-facing routing identity. Never use as the provider identity.';
comment on table public.reservation_holds is 'Short-lived, non-PII availability holds. Excluded from completed reservation quota.';
comment on table public.api_clients is 'Private hashed credentials and scopes for trusted REST/MCP clients.';
comment on table public.reservation_operation_idempotency is 'Private replay ledger for trusted reservation mutations.';
comment on table public.reservation_customer_management_tokens is 'Private hashed, scoped guest reservation management tokens. Raw tokens are never stored.';
