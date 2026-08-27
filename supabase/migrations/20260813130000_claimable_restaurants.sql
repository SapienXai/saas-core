-- Reservevia claimable restaurant acquisition engine.
-- All business-contact, import, claim, and bearer-token state is private
-- application data. Public restaurant rows only expose a safe derived CTA.

create schema if not exists private;

create table if not exists public.platform_restaurant_imports (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  original_filename text not null check (length(btrim(original_filename)) > 0 and length(original_filename) <= 255),
  total_rows integer not null default 0 check (total_rows >= 0),
  ready_rows integer not null default 0 check (ready_rows >= 0),
  warning_rows integer not null default 0 check (warning_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  created_rows integer not null default 0 check (created_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  status text not null default 'preview' check (status in ('preview', 'confirming', 'completed', 'partial', 'failed', 'expired')),
  processing_started_at timestamptz,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_claim_profiles (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  ownership_status text not null default 'claimed' check (ownership_status in ('unclaimed', 'claim_pending', 'claimed')),
  source text not null default 'legacy' check (source in ('platform_manual', 'platform_excel', 'self_service', 'legacy')),
  business_contact_email text,
  normalized_business_contact_email text,
  official_website_url text,
  official_domain text,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  source_import_id uuid references public.platform_restaurant_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_claim_profiles_email_length check (business_contact_email is null or length(btrim(business_contact_email)) <= 320),
  constraint restaurant_claim_profiles_domain_length check (official_domain is null or length(btrim(official_domain)) <= 253)
);

create table if not exists public.platform_restaurant_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.platform_restaurant_imports(id) on delete cascade,
  excel_row_number integer not null check (excel_row_number >= 2),
  normalized_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_payload) = 'object'),
  validation_status text not null check (validation_status in ('ready', 'warning', 'error')),
  validation_messages jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_messages) = 'array'),
  row_status text not null default 'pending' check (row_status in ('pending', 'processing', 'created', 'skipped', 'failed')),
  restaurant_id uuid references public.restaurants(id) on delete set null,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_restaurant_import_rows_batch_row_key unique (import_id, excel_row_number)
);

create table if not exists public.restaurant_claims (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  claimant_user_id uuid references auth.users(id) on delete set null,
  requested_email text,
  verified_email text,
  verification_method text not null default 'manual_review' check (verification_method in ('token', 'exact_email', 'official_domain', 'manual_review')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'approved', 'rejected', 'expired', 'consumed')),
  token_hash text,
  expires_at timestamptz,
  approved_by_user_id uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_by_user_id uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reservation_management_tokens (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reservation_management_tokens_hash_key unique (token_hash)
);

create index if not exists restaurant_claim_profiles_ownership_idx
  on public.restaurant_claim_profiles (ownership_status, updated_at desc);
create index if not exists restaurant_claim_profiles_email_idx
  on public.restaurant_claim_profiles (normalized_business_contact_email)
  where normalized_business_contact_email is not null;
create index if not exists restaurant_claim_profiles_domain_idx
  on public.restaurant_claim_profiles (official_domain)
  where official_domain is not null;
create index if not exists platform_restaurant_imports_actor_status_idx
  on public.platform_restaurant_imports (actor_user_id, status, created_at desc);
create index if not exists platform_restaurant_import_rows_status_idx
  on public.platform_restaurant_import_rows (import_id, row_status, validation_status);
create index if not exists restaurant_claims_restaurant_status_idx
  on public.restaurant_claims (restaurant_id, status, created_at desc);
create index if not exists restaurant_claims_token_hash_idx
  on public.restaurant_claims (token_hash)
  where token_hash is not null;
create index if not exists reservation_management_tokens_reservation_idx
  on public.reservation_management_tokens (reservation_id, expires_at desc);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'platform_restaurant_imports_set_updated_at') then
    create trigger platform_restaurant_imports_set_updated_at
      before update on public.platform_restaurant_imports
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'restaurant_claim_profiles_set_updated_at') then
    create trigger restaurant_claim_profiles_set_updated_at
      before update on public.restaurant_claim_profiles
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'platform_restaurant_import_rows_set_updated_at') then
    create trigger platform_restaurant_import_rows_set_updated_at
      before update on public.platform_restaurant_import_rows
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'restaurant_claims_set_updated_at') then
    create trigger restaurant_claims_set_updated_at
      before update on public.restaurant_claims
      for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function private.ensure_restaurant_acquisition_dependencies()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.notification_settings (restaurant_id)
  values (new.id)
  on conflict (restaurant_id) do nothing;

  insert into public.restaurant_claim_profiles (
    restaurant_id, ownership_status, source, claimed_at
  ) values (
    new.id, 'claimed', 'self_service', now()
  ) on conflict (restaurant_id) do nothing;

  return new;
end;
$$;

revoke all on function private.ensure_restaurant_acquisition_dependencies() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'restaurants_acquisition_dependencies') then
    create trigger restaurants_acquisition_dependencies
      after insert on public.restaurants
      for each row execute function private.ensure_restaurant_acquisition_dependencies();
  end if;
end $$;

-- Existing customer restaurants are claimed. This is deliberately additive:
-- no current restaurant can become claimable due to this migration.
insert into public.restaurant_claim_profiles (restaurant_id, ownership_status, source, claimed_at)
select restaurant.id, 'claimed', 'legacy', now()
from public.restaurants restaurant
on conflict (restaurant_id) do nothing;

insert into public.notification_settings (restaurant_id)
select restaurant.id
from public.restaurants restaurant
on conflict (restaurant_id) do nothing;

create or replace function private.provision_restaurant_workspace(
  target_restaurant_name text,
  target_workspace_name text default null,
  target_restaurant_slug text default null,
  target_workspace_id uuid default null,
  target_owner_user_id uuid default null,
  target_restaurant_status text default 'unpublished',
  target_claim_status text default 'claimed',
  target_source text default 'self_service',
  target_business_contact_email text default null,
  target_official_website_url text default null,
  target_official_domain text default null,
  target_source_import_id uuid default null,
  target_profile jsonb default '{}'::jsonb
)
returns table (
  workspace_id uuid,
  restaurant_id uuid,
  workspace_slug text,
  restaurant_slug text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  restaurant_name_value text := btrim(coalesce(target_restaurant_name, ''));
  workspace_name_value text := btrim(coalesce(nullif(target_workspace_name, ''), target_restaurant_name, ''));
  restaurant_base_slug text;
  restaurant_candidate_slug text;
  workspace_base_slug text;
  workspace_candidate_slug text;
  workspace_row public.workspaces%rowtype;
  restaurant_row public.restaurants%rowtype;
  suffix integer := 2;
begin
  if restaurant_name_value = '' or length(restaurant_name_value) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_NAME';
  end if;
  if workspace_name_value = '' or length(workspace_name_value) > 120 then
    workspace_name_value := restaurant_name_value;
  end if;
  if target_restaurant_status not in ('published', 'unpublished') then
    raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_STATUS';
  end if;
  if target_claim_status not in ('unclaimed', 'claim_pending', 'claimed') then
    raise exception using errcode = 'P0001', message = 'INVALID_CLAIM_STATUS';
  end if;
  if target_source not in ('platform_manual', 'platform_excel', 'self_service', 'legacy') then
    raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_SOURCE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(restaurant_name_value) || ':' || coalesce(target_restaurant_slug, ''), 0));

  if target_workspace_id is not null then
    select * into workspace_row
    from public.workspaces
    where id = target_workspace_id
    for update;
    if workspace_row.id is null then
      raise exception using errcode = 'P0001', message = 'WORKSPACE_NOT_FOUND';
    end if;
  else
    workspace_base_slug := lower(trim(both '-' from regexp_replace(workspace_name_value, '[^a-zA-Z0-9]+', '-', 'g')));
    if workspace_base_slug = '' then workspace_base_slug := 'workspace'; end if;
    workspace_candidate_slug := left(workspace_base_slug, 63);
    suffix := 2;
    while exists (select 1 from public.workspaces where slug = workspace_candidate_slug) loop
      workspace_candidate_slug := left(workspace_base_slug, 58) || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;

    insert into public.workspaces (name, slug, status, created_by)
    values (workspace_name_value, workspace_candidate_slug, 'active', target_owner_user_id)
    returning * into workspace_row;
  end if;

  restaurant_base_slug := lower(trim(both '-' from regexp_replace(
    coalesce(nullif(btrim(target_restaurant_slug), ''), restaurant_name_value),
    '[^a-zA-Z0-9]+', '-', 'g'
  )));
  if restaurant_base_slug = '' then restaurant_base_slug := 'restaurant'; end if;
  restaurant_candidate_slug := left(restaurant_base_slug, 63);
  if target_restaurant_slug is not null and btrim(target_restaurant_slug) <> '' and exists (select 1 from public.restaurants where slug = restaurant_candidate_slug) then
    raise exception using errcode = 'P0001', message = 'SLUG_CONFLICT';
  end if;
  suffix := 2;
  while exists (select 1 from public.restaurants where slug = restaurant_candidate_slug) loop
    restaurant_candidate_slug := left(restaurant_base_slug, 58) || '-' || suffix::text;
    suffix := suffix + 1;
  end loop;

  if target_owner_user_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (workspace_row.id, target_owner_user_id, 'owner')
    on conflict on constraint workspace_members_workspace_user_key do update set role = 'owner', updated_at = now();
  end if;

  insert into public.restaurants (
    workspace_id, name, slug, status, reservation_enabled, timezone, language, media_type,
    description, cuisine, location, phone, hours, atmosphere,
    opening_time, closing_time, time_slot_duration, advance_booking_days,
    min_advance_hours, min_party_size, max_party_size, meal_only_reservations,
    allowed_days_of_week, reservation_start_date, reservation_blocked_intervals, reservation_notices
  ) values (
    workspace_row.id, restaurant_name_value, restaurant_candidate_slug,
    target_restaurant_status,
    coalesce((target_profile->>'reservation_enabled')::boolean, true),
    coalesce(nullif(btrim(target_profile->>'timezone'), ''), 'UTC'),
    coalesce(nullif(btrim(target_profile->>'language'), ''), 'en'),
    coalesce(nullif(btrim(target_profile->>'media_type'), ''), 'slideshow'),
    nullif(btrim(target_profile->>'description'), ''),
    nullif(btrim(target_profile->>'cuisine'), ''),
    nullif(btrim(target_profile->>'location'), ''),
    nullif(btrim(target_profile->>'phone'), ''),
    nullif(btrim(target_profile->>'hours'), ''),
    nullif(btrim(target_profile->>'atmosphere'), ''),
    coalesce(nullif(btrim(target_profile->>'opening_time'), '')::time, '09:00'::time),
    coalesce(nullif(btrim(target_profile->>'closing_time'), '')::time, '22:00'::time),
    coalesce((target_profile->>'time_slot_duration')::integer, 30),
    coalesce((target_profile->>'advance_booking_days')::integer, 30),
    coalesce((target_profile->>'min_advance_hours')::integer, 2),
    coalesce((target_profile->>'min_party_size')::integer, 1),
    coalesce((target_profile->>'max_party_size')::integer, 12),
    coalesce((target_profile->>'meal_only_reservations')::boolean, false),
    array(
      select jsonb_array_elements_text(
        coalesce(target_profile->'allowed_days_of_week', '[1,2,3,4,5,6,7]'::jsonb)
      )::integer
    ),
    nullif(btrim(target_profile->>'reservation_start_date'), '')::date,
    coalesce(target_profile->'reservation_blocked_intervals', '[]'::jsonb),
    coalesce(target_profile->'reservation_notices', '[]'::jsonb)
  ) returning * into restaurant_row;

  update public.restaurant_claim_profiles as claim_profile
  set ownership_status = target_claim_status,
      source = target_source,
      business_contact_email = nullif(btrim(target_business_contact_email), ''),
      normalized_business_contact_email = nullif(lower(btrim(target_business_contact_email)), ''),
      official_website_url = nullif(btrim(target_official_website_url), ''),
      official_domain = nullif(lower(btrim(target_official_domain)), ''),
      claimed_by_user_id = case when target_claim_status = 'claimed' then target_owner_user_id else null end,
      claimed_at = case when target_claim_status = 'claimed' then now() else null end,
      source_import_id = target_source_import_id,
      updated_at = now()
  where claim_profile.restaurant_id = restaurant_row.id;

  if target_owner_user_id is not null then
    insert into public.admin_profiles (id, role, restaurant_id)
    values (target_owner_user_id, 'admin', restaurant_row.id)
    on conflict (id) do update
      set role = case when public.admin_profiles.role = 'readonly' then 'admin' else public.admin_profiles.role end,
          restaurant_id = coalesce(public.admin_profiles.restaurant_id, excluded.restaurant_id),
          updated_at = now();
  end if;

  return query select workspace_row.id, restaurant_row.id, workspace_row.slug, restaurant_row.slug;
end;
$$;

create or replace function public.provision_restaurant_workspace(
  target_restaurant_name text,
  target_workspace_name text default null,
  target_restaurant_slug text default null,
  target_workspace_id uuid default null,
  target_owner_user_id uuid default null,
  target_restaurant_status text default 'unpublished',
  target_claim_status text default 'claimed',
  target_source text default 'self_service',
  target_business_contact_email text default null,
  target_official_website_url text default null,
  target_official_domain text default null,
  target_source_import_id uuid default null,
  target_profile jsonb default '{}'::jsonb
)
returns table (
  workspace_id uuid,
  restaurant_id uuid,
  workspace_slug text,
  restaurant_slug text
)
language sql
security definer
set search_path = public, private
as $$
  select * from private.provision_restaurant_workspace(
    target_restaurant_name,
    target_workspace_name,
    target_restaurant_slug,
    target_workspace_id,
    target_owner_user_id,
    target_restaurant_status,
    target_claim_status,
    target_source,
    target_business_contact_email,
    target_official_website_url,
    target_official_domain,
    target_source_import_id,
    target_profile
  );
$$;

revoke all on function private.provision_restaurant_workspace(text, text, text, uuid, uuid, text, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.provision_restaurant_workspace(text, text, text, uuid, uuid, text, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.provision_restaurant_workspace(text, text, text, uuid, uuid, text, text, text, text, text, text, uuid, jsonb) to service_role;

create or replace function public.create_reservation_access_records(
  target_restaurant_id uuid,
  target_reservation_id uuid,
  target_business_email text,
  target_claim_token_hash text,
  target_claim_expires_at timestamptz,
  target_manage_token_hash text,
  target_manage_expires_at timestamptz
)
returns table (claim_id uuid, management_token_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  claim_row public.restaurant_claims%rowtype;
  management_row public.reservation_management_tokens%rowtype;
begin
  if target_restaurant_id is null or target_reservation_id is null
    or target_claim_token_hash is null or target_manage_token_hash is null then
    raise exception using errcode = 'P0001', message = 'RESERVATION_ACCESS_INPUT_INVALID';
  end if;

  insert into public.restaurant_claims (
    restaurant_id, reservation_id, requested_email, verification_method,
    status, token_hash, expires_at, metadata
  ) values (
    target_restaurant_id, target_reservation_id, lower(btrim(target_business_email)),
    'token', 'pending', target_claim_token_hash, target_claim_expires_at,
    jsonb_build_object('origin', 'unclaimed_reservation')
  ) returning * into claim_row;

  insert into public.reservation_management_tokens (
    reservation_id, restaurant_id, token_hash, expires_at
  ) values (
    target_reservation_id, target_restaurant_id, target_manage_token_hash, target_manage_expires_at
  ) returning * into management_row;

  return query select claim_row.id, management_row.id;
end;
$$;

revoke all on function public.create_reservation_access_records(uuid, uuid, text, text, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_reservation_access_records(uuid, uuid, text, text, timestamptz, text, timestamptz) to service_role;

create or replace function public.complete_restaurant_claim(
  target_restaurant_id uuid,
  target_user_id uuid,
  target_verified_email text,
  target_verification_method text
)
returns table (restaurant_id uuid, workspace_id uuid, claimed_at timestamptz)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  profile_row public.restaurant_claim_profiles%rowtype;
  restaurant_row public.restaurants%rowtype;
  claimed_at_value timestamptz := now();
begin
  if target_user_id is null or target_restaurant_id is null then
    raise exception using errcode = 'P0001', message = 'CLAIM_INPUT_INVALID';
  end if;
  if target_verification_method not in ('exact_email', 'official_domain', 'manual_review', 'token') then
    raise exception using errcode = 'P0001', message = 'CLAIM_METHOD_INVALID';
  end if;

  select * into restaurant_row from public.restaurants where id = target_restaurant_id for update;
  select claim_profile.* into profile_row
  from public.restaurant_claim_profiles as claim_profile
  where claim_profile.restaurant_id = target_restaurant_id
  for update;
  if restaurant_row.id is null or profile_row.restaurant_id is null then
    raise exception using errcode = 'P0001', message = 'CLAIM_RESTAURANT_NOT_FOUND';
  end if;
  if profile_row.ownership_status = 'claimed' and profile_row.claimed_by_user_id = target_user_id then
    return query select restaurant_row.id, restaurant_row.workspace_id, profile_row.claimed_at;
    return;
  end if;
  if profile_row.ownership_status = 'claimed' then
    raise exception using errcode = 'P0001', message = 'RESTAURANT_ALREADY_CLAIMED';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (restaurant_row.workspace_id, target_user_id, 'owner')
  on conflict on constraint workspace_members_workspace_user_key do update set role = 'owner', updated_at = now();

  insert into public.admin_profiles (id, role, restaurant_id)
  values (target_user_id, 'admin', restaurant_row.id)
  on conflict (id) do update
    set role = case when public.admin_profiles.role = 'readonly' then 'admin' else public.admin_profiles.role end,
        restaurant_id = coalesce(public.admin_profiles.restaurant_id, excluded.restaurant_id),
        updated_at = now();

  update public.restaurant_claim_profiles as claim_profile
  set ownership_status = 'claimed',
      claimed_by_user_id = target_user_id,
      claimed_at = claimed_at_value,
      updated_at = claimed_at_value
  where claim_profile.restaurant_id = restaurant_row.id;

  update public.restaurant_claims as claim_request
  set status = 'consumed',
      claimant_user_id = target_user_id,
      verified_email = nullif(lower(btrim(target_verified_email)), ''),
      verification_method = target_verification_method,
      approved_by_user_id = target_user_id,
      approved_at = claimed_at_value,
      consumed_at = claimed_at_value,
      updated_at = claimed_at_value
  where claim_request.restaurant_id = restaurant_row.id
    and status in ('pending', 'verified', 'approved');

  return query select restaurant_row.id, restaurant_row.workspace_id, claimed_at_value;
end;
$$;

revoke all on function public.complete_restaurant_claim(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_restaurant_claim(uuid, uuid, text, text) to service_role;

alter table public.platform_restaurant_imports enable row level security;
alter table public.platform_restaurant_import_rows enable row level security;
alter table public.restaurant_claim_profiles enable row level security;
alter table public.restaurant_claims enable row level security;
alter table public.reservation_management_tokens enable row level security;

revoke all on public.platform_restaurant_imports from anon, authenticated;
revoke all on public.platform_restaurant_import_rows from anon, authenticated;
revoke all on public.restaurant_claim_profiles from anon, authenticated;
revoke all on public.restaurant_claims from anon, authenticated;
revoke all on public.reservation_management_tokens from anon, authenticated;
revoke all on public.platform_restaurant_imports from public;
revoke all on public.platform_restaurant_import_rows from public;
revoke all on public.restaurant_claim_profiles from public;
revoke all on public.restaurant_claims from public;
revoke all on public.reservation_management_tokens from public;
grant all on public.platform_restaurant_imports to service_role;
grant all on public.platform_restaurant_import_rows to service_role;
grant all on public.restaurant_claim_profiles to service_role;
grant all on public.restaurant_claims to service_role;
grant all on public.reservation_management_tokens to service_role;

comment on table public.restaurant_claim_profiles is 'Private ownership and business-contact projection. Never exposed to anonymous or ordinary authenticated reads.';
comment on table public.platform_restaurant_imports is 'Private server-validated platform import batches; client preview is never authoritative.';
comment on table public.restaurant_claims is 'Private claim requests and hashed claim bearer tokens.';
comment on table public.reservation_management_tokens is 'Private hashed bearer tokens for accountless business reservation management.';
comment on function public.provision_restaurant_workspace(text, text, text, uuid, uuid, text, text, text, text, text, text, uuid, jsonb) is 'Service-role-only atomic provisioning for self-service-compatible and platform-created restaurant workspaces.';
comment on function public.create_reservation_access_records(uuid, uuid, text, text, timestamptz, text, timestamptz) is 'Service-role-only atomic creation of hashed claim and reservation-management bearer records.';
comment on function public.complete_restaurant_claim(uuid, uuid, text, text) is 'Service-role-only idempotent ownership claim. It never changes restaurants.workspace_id.';

notify pgrst, 'reload schema';
