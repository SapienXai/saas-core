-- Add a guarded update mode to the private platform import workflow.
-- Existing rows keep their restaurant/workspace/ownership identity.

alter table public.platform_restaurant_imports
  add column if not exists mode text not null default 'create';

alter table public.platform_restaurant_imports
  add column if not exists updated_rows integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_restaurant_imports_mode_check'
      and conrelid = 'public.platform_restaurant_imports'::regclass
  ) then
    alter table public.platform_restaurant_imports
      add constraint platform_restaurant_imports_mode_check check (mode in ('create', 'update'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_restaurant_imports_updated_rows_check'
      and conrelid = 'public.platform_restaurant_imports'::regclass
  ) then
    alter table public.platform_restaurant_imports
      add constraint platform_restaurant_imports_updated_rows_check check (updated_rows >= 0);
  end if;

  alter table public.platform_restaurant_import_rows
    drop constraint if exists platform_restaurant_import_rows_row_status_check;

  alter table public.platform_restaurant_import_rows
    add constraint platform_restaurant_import_rows_row_status_check
    check (row_status in ('pending', 'processing', 'created', 'updated', 'skipped', 'failed'));
end $$;

create or replace function private.update_platform_restaurant_from_import(
  target_restaurant_id uuid,
  target_payload jsonb,
  target_provided_fields text[] default null
)
returns table (
  restaurant_id uuid,
  workspace_id uuid,
  restaurant_slug text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  restaurant_row public.restaurants%rowtype;
  claim_profile_row public.restaurant_claim_profiles%rowtype;
  fields text[] := coalesce(
    target_provided_fields,
    array[
      'name', 'business_contact_email', 'official_website_url', 'official_domain',
      'description', 'cuisine', 'location', 'phone', 'hours', 'atmosphere',
      'address_line1', 'address_line2', 'address_locality', 'address_region', 'address_postal_code', 'address_country', 'latitude', 'longitude',
      'timezone', 'language', 'reservation_enabled', 'opening_time', 'closing_time',
      'time_slot_duration', 'advance_booking_days', 'min_advance_hours',
      'min_party_size', 'max_party_size', 'meal_only_reservations'
    ]::text[]
  );
  name_value text;
  email_value text;
  website_value text;
begin
  select *
  into restaurant_row
  from public.restaurants as restaurant
  where restaurant.id = target_restaurant_id
  for update;

  if restaurant_row.id is null then
    raise exception using errcode = 'P0001', message = 'RESTAURANT_NOT_FOUND';
  end if;

  select *
  into claim_profile_row
  from public.restaurant_claim_profiles as claim_profile
  where claim_profile.restaurant_id = target_restaurant_id
  for update;

  if claim_profile_row.restaurant_id is null then
    raise exception using errcode = 'P0001', message = 'CLAIM_PROFILE_NOT_FOUND';
  end if;

  if claim_profile_row.source not in ('platform_manual', 'platform_excel') then
    raise exception using errcode = 'P0001', message = 'RESTAURANT_NOT_PLATFORM_CREATED';
  end if;

  name_value := nullif(btrim(target_payload->>'name'), '');
  email_value := nullif(lower(btrim(target_payload->>'business_contact_email')), '');
  website_value := nullif(btrim(target_payload->>'official_website_url'), '');

  if 'name' = any(fields) and name_value is null then
    raise exception using errcode = 'P0001', message = 'RESTAURANT_NAME_REQUIRED';
  end if;
  if 'business_contact_email' = any(fields) and email_value is null then
    raise exception using errcode = 'P0001', message = 'BUSINESS_EMAIL_REQUIRED';
  end if;
  if 'official_website_url' = any(fields) and website_value is null then
    raise exception using errcode = 'P0001', message = 'OFFICIAL_WEBSITE_REQUIRED';
  end if;

  -- The slug and workspace_id are intentionally not part of this update.
  update public.restaurants
  set name = case when 'name' = any(fields) then name_value else name end,
      description = case when 'description' = any(fields) then nullif(btrim(target_payload->>'description'), '') else description end,
      cuisine = case when 'cuisine' = any(fields) then nullif(btrim(target_payload->>'cuisine'), '') else cuisine end,
      location = case when 'location' = any(fields) then nullif(btrim(target_payload->>'location'), '') else location end,
      phone = case when 'phone' = any(fields) then nullif(btrim(target_payload->>'phone'), '') else phone end,
      address_line1 = case when 'address_line1' = any(fields) then nullif(btrim(target_payload->>'address_line1'), '') else address_line1 end,
      address_line2 = case when 'address_line2' = any(fields) then nullif(btrim(target_payload->>'address_line2'), '') else address_line2 end,
      address_locality = case when 'address_locality' = any(fields) then nullif(btrim(target_payload->>'address_locality'), '') else address_locality end,
      address_region = case when 'address_region' = any(fields) then nullif(btrim(target_payload->>'address_region'), '') else address_region end,
      address_postal_code = case when 'address_postal_code' = any(fields) then nullif(btrim(target_payload->>'address_postal_code'), '') else address_postal_code end,
      address_country = case when 'address_country' = any(fields) then nullif(btrim(target_payload->>'address_country'), '') else address_country end,
      latitude = case when 'latitude' = any(fields) then nullif(target_payload->>'latitude', '')::double precision else latitude end,
      longitude = case when 'longitude' = any(fields) then nullif(target_payload->>'longitude', '')::double precision else longitude end,
      official_website_url = case when 'official_website_url' = any(fields) then website_value else official_website_url end,
      hours = case when 'hours' = any(fields) then nullif(btrim(target_payload->>'hours'), '') else hours end,
      atmosphere = case when 'atmosphere' = any(fields) then nullif(btrim(target_payload->>'atmosphere'), '') else atmosphere end,
      timezone = case when 'timezone' = any(fields) then coalesce(nullif(btrim(target_payload->>'timezone'), ''), timezone) else timezone end,
      language = case when 'language' = any(fields) then coalesce(nullif(lower(btrim(target_payload->>'language')), ''), language) else language end,
      reservation_enabled = case when 'reservation_enabled' = any(fields) then coalesce((target_payload->>'reservation_enabled')::boolean, reservation_enabled) else reservation_enabled end,
      opening_time = case when 'opening_time' = any(fields) then coalesce(nullif(btrim(target_payload->>'opening_time'), '')::time, opening_time) else opening_time end,
      closing_time = case when 'closing_time' = any(fields) then coalesce(nullif(btrim(target_payload->>'closing_time'), '')::time, closing_time) else closing_time end,
      time_slot_duration = case when 'time_slot_duration' = any(fields) then coalesce((target_payload->>'time_slot_duration')::integer, time_slot_duration) else time_slot_duration end,
      advance_booking_days = case when 'advance_booking_days' = any(fields) then coalesce((target_payload->>'advance_booking_days')::integer, advance_booking_days) else advance_booking_days end,
      min_advance_hours = case when 'min_advance_hours' = any(fields) then coalesce((target_payload->>'min_advance_hours')::integer, min_advance_hours) else min_advance_hours end,
      min_party_size = case when 'min_party_size' = any(fields) then coalesce((target_payload->>'min_party_size')::integer, min_party_size) else min_party_size end,
      max_party_size = case when 'max_party_size' = any(fields) then coalesce((target_payload->>'max_party_size')::integer, max_party_size) else max_party_size end,
      meal_only_reservations = case when 'meal_only_reservations' = any(fields) then coalesce((target_payload->>'meal_only_reservations')::boolean, meal_only_reservations) else meal_only_reservations end,
      updated_at = now()
  where public.restaurants.id = target_restaurant_id;

  update public.restaurant_claim_profiles
  set business_contact_email = case when 'business_contact_email' = any(fields) then email_value else business_contact_email end,
      normalized_business_contact_email = case when 'business_contact_email' = any(fields) then email_value else normalized_business_contact_email end,
      official_website_url = case when 'official_website_url' = any(fields) then website_value else official_website_url end,
      official_domain = case when 'official_domain' = any(fields) then nullif(lower(btrim(target_payload->>'official_domain')), '') else official_domain end,
      updated_at = now()
  where public.restaurant_claim_profiles.restaurant_id = target_restaurant_id;

  return query
  select restaurant_row.id, restaurant_row.workspace_id, restaurant_row.slug;
end;
$$;

revoke all on function private.update_platform_restaurant_from_import(uuid, jsonb, text[]) from public, anon, authenticated;

create or replace function public.update_platform_restaurant_from_import(
  target_restaurant_id uuid,
  target_payload jsonb,
  target_provided_fields text[] default null
)
returns table (
  restaurant_id uuid,
  workspace_id uuid,
  restaurant_slug text
)
language sql
security definer
set search_path = public, private
as $$
  select * from private.update_platform_restaurant_from_import(
    target_restaurant_id,
    target_payload,
    target_provided_fields
  );
$$;

revoke all on function public.update_platform_restaurant_from_import(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.update_platform_restaurant_from_import(uuid, jsonb, text[]) to service_role;
