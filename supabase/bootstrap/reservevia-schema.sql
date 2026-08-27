


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_trgm";


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "private"."assign_default_workspace_subscription"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  insert into public.workspace_subscriptions (
    workspace_id, plan_key, status, source, current_period_start, current_period_end
  )
  values (
    new.id, 'free', 'active', 'free',
    private.calendar_period_start(current_date),
    private.calendar_period_end(current_date)
  )
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "private"."assign_default_workspace_subscription"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."calendar_period_end"("target_date" "date" DEFAULT CURRENT_DATE) RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select (date_trunc('month', target_date::timestamp) + interval '1 month')::date;
$$;


ALTER FUNCTION "private"."calendar_period_end"("target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."calendar_period_start"("target_date" "date" DEFAULT CURRENT_DATE) RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select date_trunc('month', target_date::timestamp)::date;
$$;


ALTER FUNCTION "private"."calendar_period_start"("target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_restaurant_asset_path"("object_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private', 'storage'
    AS $_$
declare
  parts text[];
  workspace_id_value uuid;
  restaurant_id_value uuid;
begin
  if object_name ~ '^[0-9a-fA-F-]{36}/pwa/icon/[^/]+$' then
    parts := storage.foldername(object_name);
    begin
      workspace_id_value := parts[1]::uuid;
    exception when invalid_text_representation then
      return false;
    end;

    return exists (
      select 1
      from public.workspace_members as membership
      join public.workspaces as workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = workspace_id_value
        and membership.user_id = auth.uid()
        and membership.role in ('owner', 'admin')
        and workspace.status = 'active'
        and private.workspace_feature_enabled(workspace_id_value, 'customPWA')
    );
  end if;

  if object_name !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/(logo|primary)/[^/]+$' then
    return false;
  end if;

  parts := storage.foldername(object_name);
  begin
    workspace_id_value := parts[1]::uuid;
    restaurant_id_value := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if not exists (
    select 1
    from public.restaurants as restaurant
    join public.workspace_members as membership on membership.workspace_id = restaurant.workspace_id
    join public.workspaces as workspace on workspace.id = membership.workspace_id
    where restaurant.id = restaurant_id_value
      and restaurant.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin', 'manager')
      and workspace.status = 'active'
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin')
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role = 'manager'
      and membership.restaurant_access_mode = 'all'
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.workspace_member_restaurants as assignment
    join public.workspace_members as membership on membership.id = assignment.member_id
    where assignment.restaurant_id = restaurant_id_value
      and membership.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role = 'manager'
  );
end;
$_$;


ALTER FUNCTION "private"."can_manage_restaurant_asset_path"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."consume_reservation_quota"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  target_workspace_id uuid;
  usage_start date;
  usage_end date;
  subscription_plan_key text := 'free';
  subscription_status text := 'active';
  payment_grace_ends_at timestamptz;
  reservation_limit integer;
  current_usage integer;
begin
  select restaurant.workspace_id
    into target_workspace_id
  from public.restaurants as restaurant
  where restaurant.id = new.restaurant_id;

  if target_workspace_id is null then
    raise exception using
      errcode = '23514',
      message = 'Reservation restaurant has no workspace owner.';
  end if;

  select
    subscription.plan_key,
    subscription.status,
    subscription.payment_grace_ends_at
  into subscription_plan_key, subscription_status, payment_grace_ends_at
  from public.workspace_subscriptions as subscription
  where subscription.workspace_id = target_workspace_id
  for update;

  if subscription_status = 'past_due'
    and payment_grace_ends_at is not null
    and payment_grace_ends_at <= now()
  then
    subscription_plan_key := 'free';
  end if;

  usage_start := private.calendar_period_start(current_date);
  usage_end := private.calendar_period_end(current_date);

  select plan.reservation_limit
    into reservation_limit
  from public.plans as plan
  where plan.key = coalesce(subscription_plan_key, 'free');

  if reservation_limit is null and not exists (
    select 1 from public.plans where key = coalesce(subscription_plan_key, 'free')
  ) then
    select free_plan.reservation_limit into reservation_limit
    from public.plans as free_plan
    where free_plan.key = 'free';
  end if;

  -- The unique key plus the row lock make the check and increment one
  -- serialized operation. Any later reservation error rolls this update back
  -- with the insert; status changes never call this function.
  insert into public.workspace_usage_periods (
    workspace_id, period_start, period_end, reservations_created
  )
  values (target_workspace_id, usage_start, usage_end, 0)
  on conflict (workspace_id, period_start, period_end) do nothing;

  select usage.reservations_created
    into current_usage
  from public.workspace_usage_periods as usage
  where usage.workspace_id = target_workspace_id
    and usage.period_start = usage_start
    and usage.period_end = usage_end
  for update;

  if reservation_limit is not null and current_usage >= reservation_limit then
    raise exception using
      errcode = 'P0001',
      message = 'Monthly reservation limit reached.',
      detail = 'RESERVATION_LIMIT_REACHED';
  end if;

  update public.workspace_usage_periods
  set reservations_created = reservations_created + 1,
      updated_at = now()
  where workspace_id = target_workspace_id
    and period_start = usage_start
    and period_end = usage_end;

  return new;
end;
$$;


ALTER FUNCTION "private"."consume_reservation_quota"() OWNER TO "postgres";


COMMENT ON FUNCTION "private"."consume_reservation_quota"() IS 'Atomic calendar-month reservation quota enforcement for every reservation entry point.';



CREATE OR REPLACE FUNCTION "private"."enforce_workspace_member_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  user_limit integer;
  member_count integer;
  pending_invitation_count integer;
begin
  perform 1
  from public.workspace_subscriptions
  where workspace_id = new.workspace_id
  for update;

  select plan.user_limit
    into user_limit
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key
  where subscription.workspace_id = new.workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');

  if user_limit is null then
    select free_plan.user_limit into user_limit
    from public.plans as free_plan
    where free_plan.key = 'free';
  end if;

  select count(*) into member_count
  from public.workspace_members
  where workspace_id = new.workspace_id;

  select count(*) into pending_invitation_count
  from public.workspace_invitations
  where workspace_id = new.workspace_id
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  if user_limit is not null and member_count + pending_invitation_count >= user_limit then
    raise exception using
      errcode = 'P0001',
      message = 'User limit reached for the current plan.',
      detail = 'USER_LIMIT_REACHED';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."enforce_workspace_member_limit"() OWNER TO "postgres";


COMMENT ON FUNCTION "private"."enforce_workspace_member_limit"() IS 'Concurrency-safe protection for new workspace membership rows.';



CREATE OR REPLACE FUNCTION "private"."enforce_workspace_restaurant_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  restaurant_limit integer;
  restaurant_count integer;
begin
  if new.workspace_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.workspace_id is distinct from new.workspace_id then
    raise exception using
      errcode = 'P0001',
      message = 'Restaurant workspace ownership cannot be changed.';
  end if;

  perform 1
  from public.workspace_subscriptions
  where workspace_id = new.workspace_id
  for update;

  select plan.restaurant_limit
    into restaurant_limit
  from public.workspace_subscriptions as subscription
  left join lateral (
    select override.plan_key
    from public.subscription_overrides as override
    where override.workspace_id = subscription.workspace_id
      and override.revoked_at is null
      and override.effective_from <= now()
      and (override.effective_until is null or override.effective_until > now())
    order by override.effective_from desc
    limit 1
  ) as effective_override on true
  left join lateral (
    select subscription.scheduled_plan_key as plan_key
    where subscription.scheduled_plan_at <= current_date
  ) as effective_scheduled on true
  join public.plans as plan on plan.key = coalesce(effective_override.plan_key, effective_scheduled.plan_key, subscription.plan_key)
  where subscription.workspace_id = new.workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');

  if restaurant_limit is null then
    select free_plan.restaurant_limit into restaurant_limit
    from public.plans as free_plan
    where free_plan.key = 'free';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into restaurant_count
    from public.restaurants
    where workspace_id = new.workspace_id;
  else
    select count(*) into restaurant_count
    from public.restaurants
    where workspace_id = new.workspace_id
      and id <> new.id;
  end if;

  if restaurant_limit is not null and restaurant_count >= restaurant_limit then
    raise exception using
      errcode = 'P0001',
      message = 'Restaurant limit reached for the current plan.',
      detail = 'RESTAURANT_LIMIT_REACHED';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."enforce_workspace_restaurant_limit"() OWNER TO "postgres";


COMMENT ON FUNCTION "private"."enforce_workspace_restaurant_limit"() IS 'Concurrency-safe restaurant limit enforcement using the effective workspace plan override.';



CREATE OR REPLACE FUNCTION "private"."ensure_restaurant_acquisition_dependencies"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
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


ALTER FUNCTION "private"."ensure_restaurant_acquisition_dependencies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."provision_restaurant_workspace"("target_restaurant_name" "text", "target_workspace_name" "text" DEFAULT NULL::"text", "target_restaurant_slug" "text" DEFAULT NULL::"text", "target_workspace_id" "uuid" DEFAULT NULL::"uuid", "target_owner_user_id" "uuid" DEFAULT NULL::"uuid", "target_restaurant_status" "text" DEFAULT 'unpublished'::"text", "target_claim_status" "text" DEFAULT 'claimed'::"text", "target_source" "text" DEFAULT 'self_service'::"text", "target_business_contact_email" "text" DEFAULT NULL::"text", "target_official_website_url" "text" DEFAULT NULL::"text", "target_official_domain" "text" DEFAULT NULL::"text", "target_source_import_id" "uuid" DEFAULT NULL::"uuid", "target_profile" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("workspace_id" "uuid", "restaurant_id" "uuid", "workspace_slug" "text", "restaurant_slug" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
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


ALTER FUNCTION "private"."provision_restaurant_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text", "target_workspace_id" "uuid", "target_owner_user_id" "uuid", "target_restaurant_status" "text", "target_claim_status" "text", "target_source" "text", "target_business_contact_email" "text", "target_official_website_url" "text", "target_official_domain" "text", "target_source_import_id" "uuid", "target_profile" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."remove_platform_user_directory"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  delete from public.platform_user_directory where user_id = old.id;
  return old;
end;
$$;


ALTER FUNCTION "private"."remove_platform_user_directory"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_platform_user_directory"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  insert into public.platform_user_directory (user_id, email, full_name, last_sign_in_at, created_at, updated_at)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    new.last_sign_in_at,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (user_id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    last_sign_in_at = excluded.last_sign_in_at,
    updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_platform_user_directory"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."update_platform_restaurant_from_import"("target_restaurant_id" "uuid", "target_payload" "jsonb", "target_provided_fields" "text"[] DEFAULT NULL::"text"[]) RETURNS TABLE("restaurant_id" "uuid", "workspace_id" "uuid", "restaurant_slug" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  restaurant_row public.restaurants%rowtype;
  claim_profile_row public.restaurant_claim_profiles%rowtype;
  fields text[] := coalesce(
    target_provided_fields,
    array[
      'name', 'business_contact_email', 'official_website_url', 'official_domain',
      'description', 'cuisine', 'location', 'phone', 'hours', 'atmosphere',
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


ALTER FUNCTION "private"."update_platform_restaurant_from_import"("target_restaurant_id" "uuid", "target_payload" "jsonb", "target_provided_fields" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."user_can_access_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select exists (
    select 1
    from public.restaurants as restaurant
    join public.workspace_members as membership
      on membership.workspace_id = restaurant.workspace_id
    join public.workspaces as workspace
      on workspace.id = membership.workspace_id
    where restaurant.id = target_restaurant_id
      and membership.user_id = target_user_id
      and workspace.status = 'active'
      and (
        membership.role in ('owner', 'admin')
        or membership.restaurant_access_mode = 'all'
        or exists (
          select 1
          from public.workspace_member_restaurants as assignment
          where assignment.member_id = membership.id
            and assignment.restaurant_id = target_restaurant_id
        )
      )
  );
$$;


ALTER FUNCTION "private"."user_can_access_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."user_can_operate_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select exists (
    select 1
    from public.restaurants as restaurant
    join public.workspace_members as membership
      on membership.workspace_id = restaurant.workspace_id
    join public.workspaces as workspace
      on workspace.id = membership.workspace_id
    where restaurant.id = target_restaurant_id
      and membership.user_id = target_user_id
      and workspace.status = 'active'
      and membership.role in ('owner', 'admin', 'manager', 'staff')
      and (
        membership.role in ('owner', 'admin')
        or membership.restaurant_access_mode = 'all'
        or exists (
          select 1
          from public.workspace_member_restaurants as assignment
          where assignment.member_id = membership.id
            and assignment.restaurant_id = target_restaurant_id
        )
      )
  );
$$;


ALTER FUNCTION "private"."user_can_operate_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."workspace_feature_enabled"("target_workspace_id" "uuid", "target_feature" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select coalesce((plan.features ->> target_feature)::boolean, false)
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key and plan.active = true
  where subscription.workspace_id = target_workspace_id
  limit 1;
$$;


ALTER FUNCTION "private"."workspace_feature_enabled"("target_workspace_id" "uuid", "target_feature" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_workspace_invitation"("target_token_hash" "text") RETURNS TABLE("workspace_id" "uuid", "member_id" "uuid", "role" "text", "restaurant_access_mode" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $_$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  invitation public.workspace_invitations%rowtype;
  member public.workspace_members%rowtype;
  user_limit integer;
  member_count integer;
  compatibility_role text;
  selected_restaurant_id uuid;
  selected_restaurant_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION';
  end if;

  select lower(email) into current_email from auth.users where id = current_user_id;
  select * into invitation from public.workspace_invitations
  where token_hash = target_token_hash;
  if invitation.id is null then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND';
  end if;

  -- Match invitation acceptance to the current workspace billing/member lock.
  perform 1 from public.workspace_subscriptions as subscription_lock
  where subscription_lock.workspace_id = invitation.workspace_id
  for update;

  select * into invitation from public.workspace_invitations
  where id = invitation.id
  for update;
  if invitation.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'INVITATION_ALREADY_ACCEPTED';
  end if;
  if invitation.revoked_at is not null or invitation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'INVITATION_EXPIRED';
  end if;
  if current_email is null or current_email <> invitation.normalized_email then
    raise exception using errcode = 'P0001', message = 'INVITATION_EMAIL_MISMATCH';
  end if;
  if exists (
    select 1 from public.workspace_members as existing_member
    where existing_member.workspace_id = invitation.workspace_id and existing_member.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_MEMBER';
  end if;

  select plan.user_limit into user_limit
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key
  where subscription.workspace_id = invitation.workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');
  if user_limit is null then
    select free_plan.user_limit into user_limit from public.plans as free_plan where free_plan.key = 'free';
  end if;
  select count(*) into member_count
  from public.workspace_members as member_count_row where member_count_row.workspace_id = invitation.workspace_id;
  if user_limit is not null and member_count >= user_limit then
    raise exception using errcode = 'P0001', message = 'USER_LIMIT_REACHED', detail = 'USER_LIMIT_REACHED';
  end if;

  -- Mark the invite accepted before the member insert so the member-limit
  -- trigger does not count the same seat twice. Any failure rolls back both.
  update public.workspace_invitations
  set accepted_at = now(), updated_at = now()
  where id = invitation.id;

  insert into public.workspace_members (workspace_id, user_id, role, restaurant_access_mode)
  values (invitation.workspace_id, current_user_id, invitation.role, invitation.restaurant_access_mode)
  returning * into member;

  if invitation.restaurant_access_mode = 'selected' then
    insert into public.workspace_member_restaurants (member_id, restaurant_id)
    select member.id, assignment.restaurant_id
    from public.workspace_invitation_restaurants as assignment
    where assignment.invitation_id = invitation.id;
  end if;

  -- Preserve the minimum legacy profile bridge only when no row exists. A
  -- global admin_profiles role is never allowed to override membership auth.
  compatibility_role := case when invitation.role = 'admin' then 'admin' else invitation.role end;
  select count(*) into selected_restaurant_count
  from public.workspace_invitation_restaurants
  where invitation_id = invitation.id;
  select restaurant_id into selected_restaurant_id
  from public.workspace_invitation_restaurants
  where invitation_id = invitation.id
  order by restaurant_id
  limit 1;
  insert into public.admin_profiles (id, role, restaurant_id)
  values (
    current_user_id,
    compatibility_role,
    case when invitation.restaurant_access_mode = 'selected' and selected_restaurant_count = 1
      then selected_restaurant_id else null end
  )
  on conflict (id) do nothing;

  return query select member.workspace_id, member.id, member.role, member.restaurant_access_mode;
end;
$_$;


ALTER FUNCTION "public"."accept_workspace_invitation"("target_token_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bootstrap_initial_workspace"("target_restaurant_name" "text", "target_workspace_name" "text" DEFAULT NULL::"text", "target_restaurant_slug" "text" DEFAULT NULL::"text") RETURNS TABLE("workspace_id" "uuid", "restaurant_id" "uuid", "workspace_slug" "text", "restaurant_slug" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  current_user_id uuid := auth.uid();
  existing_workspace public.workspaces%rowtype;
  existing_restaurant public.restaurants%rowtype;
  new_workspace public.workspaces%rowtype;
  new_restaurant public.restaurants%rowtype;
  restaurant_name_value text := btrim(coalesce(target_restaurant_name, ''));
  workspace_name_value text := btrim(coalesce(nullif(target_workspace_name, ''), target_restaurant_name, ''));
  restaurant_base_slug text;
  restaurant_candidate_slug text;
  workspace_base_slug text;
  workspace_candidate_slug text;
  suffix integer := 2;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if restaurant_name_value = '' or length(restaurant_name_value) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_NAME';
  end if;

  if workspace_name_value = '' or length(workspace_name_value) > 120 then
    workspace_name_value := restaurant_name_value;
  end if;

  -- Serialize retries and concurrent first submissions for the same user.
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select * into existing_workspace
  from public.workspaces
  where created_by = current_user_id
  order by created_at, id
  limit 1
  for update;

  if existing_workspace.id is not null then
    select restaurant.* into existing_restaurant
    from public.restaurants as restaurant
    where restaurant.workspace_id = existing_workspace.id
    order by restaurant.created_at, restaurant.id
    limit 1;

    if existing_restaurant.id is not null then
      if lower(existing_restaurant.name) <> lower(restaurant_name_value)
         or (nullif(btrim(target_restaurant_slug), '') is not null
             and lower(btrim(target_restaurant_slug)) <> existing_restaurant.slug) then
        raise exception using errcode = 'P0001', message = 'SELF_SERVICE_WORKSPACE_EXISTS';
      end if;
      return query select existing_workspace.id, existing_restaurant.id,
        existing_workspace.slug, existing_restaurant.slug;
      return;
    end if;

    -- Recover a workspace created before the transaction was interrupted.
    restaurant_base_slug := lower(trim(both '-' from regexp_replace(
      coalesce(nullif(btrim(target_restaurant_slug), ''), restaurant_name_value),
      '[^a-zA-Z0-9]+', '-', 'g'
    )));
    if restaurant_base_slug = '' then restaurant_base_slug := 'restaurant'; end if;
    if restaurant_base_slug in ('www', 'app', 'api', 'admin', 'manage', 'login', 'signup', 'pricing', 'help', 'support', 'status', 'mail', 'assets', 'static') then
      raise exception using errcode = 'P0001', message = 'SLUG_RESERVED';
    end if;
    restaurant_candidate_slug := left(restaurant_base_slug, 63);
    suffix := 2;
    while exists (select 1 from public.restaurants where slug = restaurant_candidate_slug) loop
      restaurant_candidate_slug := left(restaurant_base_slug, 58) || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;

    insert into public.restaurants (workspace_id, name, slug, status, reservation_enabled, timezone, language)
    values (existing_workspace.id, restaurant_name_value, restaurant_candidate_slug, 'unpublished', true, 'UTC', 'en')
    returning * into new_restaurant;

    insert into public.admin_profiles (id, role, restaurant_id)
    values (current_user_id, 'admin', new_restaurant.id)
    on conflict (id) do update
      set restaurant_id = coalesce(public.admin_profiles.restaurant_id, excluded.restaurant_id),
          updated_at = now();

    return query select existing_workspace.id, new_restaurant.id,
      existing_workspace.slug, new_restaurant.slug;
    return;
  end if;

  restaurant_base_slug := lower(trim(both '-' from regexp_replace(
    coalesce(nullif(btrim(target_restaurant_slug), ''), restaurant_name_value),
    '[^a-zA-Z0-9]+', '-', 'g'
  )));
  if restaurant_base_slug = '' then restaurant_base_slug := 'restaurant'; end if;
  if restaurant_base_slug in ('www', 'app', 'api', 'admin', 'manage', 'login', 'signup', 'pricing', 'help', 'support', 'status', 'mail', 'assets', 'static') then
    raise exception using errcode = 'P0001', message = 'SLUG_RESERVED';
  end if;
  restaurant_candidate_slug := left(restaurant_base_slug, 63);
  suffix := 2;
  while exists (select 1 from public.restaurants where slug = restaurant_candidate_slug) loop
    restaurant_candidate_slug := left(restaurant_base_slug, 58) || '-' || suffix::text;
    suffix := suffix + 1;
  end loop;

  workspace_base_slug := lower(trim(both '-' from regexp_replace(workspace_name_value, '[^a-zA-Z0-9]+', '-', 'g')));
  if workspace_base_slug = '' then workspace_base_slug := 'workspace'; end if;
  workspace_candidate_slug := left(workspace_base_slug, 63);
  suffix := 2;
  while exists (select 1 from public.workspaces where slug = workspace_candidate_slug) loop
    workspace_candidate_slug := left(workspace_base_slug, 58) || '-' || suffix::text;
    suffix := suffix + 1;
  end loop;

  insert into public.workspaces (name, slug, status, created_by)
  values (workspace_name_value, workspace_candidate_slug, 'active', current_user_id)
  returning * into new_workspace;

  -- The workspace trigger assigns the existing database-owned Free plan.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace.id, current_user_id, 'owner');

  insert into public.restaurants (workspace_id, name, slug, status, reservation_enabled, timezone, language)
  values (new_workspace.id, restaurant_name_value, restaurant_candidate_slug, 'unpublished', true, 'UTC', 'en')
  returning * into new_restaurant;

  -- Compatibility metadata is created only for existing management surfaces;
  -- workspace_members remains the authoritative authorization source.
  insert into public.admin_profiles (id, role, restaurant_id)
  values (current_user_id, 'admin', new_restaurant.id)
  on conflict (id) do update
    set restaurant_id = coalesce(public.admin_profiles.restaurant_id, excluded.restaurant_id),
        updated_at = now();

  return query select new_workspace.id, new_restaurant.id,
    new_workspace.slug, new_restaurant.slug;
end;
$$;


ALTER FUNCTION "public"."bootstrap_initial_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bootstrap_initial_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text") IS 'Transactional first-workspace bootstrap. Uses auth.uid(), assigns the trigger-created Free subscription, and is idempotent per self-service owner.';



CREATE OR REPLACE FUNCTION "public"."can_access_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select case
    when auth.uid() is not null and target_user_id is distinct from auth.uid() then false
    else private.user_can_access_restaurant(target_restaurant_id, target_user_id)
  end;
$$;


ALTER FUNCTION "public"."can_access_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_access_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") IS 'RLS defense-in-depth for tenant reads: membership plus legacy staff restaurant assignment. Service-role application queries still perform explicit server-side authorization.';



CREATE OR REPLACE FUNCTION "public"."can_operate_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select case
    when auth.uid() is not null and target_user_id is distinct from auth.uid() then false
    else private.user_can_operate_restaurant(target_restaurant_id, target_user_id)
  end;
$$;


ALTER FUNCTION "public"."can_operate_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_operate_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") IS 'RLS defense-in-depth for tenant writes: readonly members cannot create or update reservations.';



CREATE OR REPLACE FUNCTION "public"."complete_restaurant_claim"("target_restaurant_id" "uuid", "target_user_id" "uuid", "target_verified_email" "text", "target_verification_method" "text") RETURNS TABLE("restaurant_id" "uuid", "workspace_id" "uuid", "claimed_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
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


ALTER FUNCTION "public"."complete_restaurant_claim"("target_restaurant_id" "uuid", "target_user_id" "uuid", "target_verified_email" "text", "target_verification_method" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."complete_restaurant_claim"("target_restaurant_id" "uuid", "target_user_id" "uuid", "target_verified_email" "text", "target_verification_method" "text") IS 'Service-role-only idempotent ownership claim. It never changes restaurants.workspace_id.';



CREATE OR REPLACE FUNCTION "public"."consume_public_reservation_rate_limit"("p_key_hash" "text", "p_window_seconds" integer DEFAULT 60, "p_max_attempts" integer DEFAULT 10) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $_$
declare
  current_count integer;
  now_value timestamptz := clock_timestamp();
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid reservation rate-limit key';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 3600 or p_max_attempts < 1 or p_max_attempts > 100 then
    raise exception 'invalid reservation rate-limit configuration';
  end if;

  insert into public.public_reservation_rate_limits (key_hash, window_started_at, attempt_count, updated_at)
  values (p_key_hash, now_value, 1, now_value)
  on conflict (key_hash) do update
  set
    window_started_at = case
      when public.public_reservation_rate_limits.window_started_at <= now_value - make_interval(secs => p_window_seconds)
        then now_value
      else public.public_reservation_rate_limits.window_started_at
    end,
    attempt_count = case
      when public.public_reservation_rate_limits.window_started_at <= now_value - make_interval(secs => p_window_seconds)
        then 1
      else public.public_reservation_rate_limits.attempt_count + 1
    end,
    updated_at = now_value
  returning attempt_count into current_count;

  if random() < 0.01 then
    delete from public.public_reservation_rate_limits
    where updated_at < now_value - interval '1 day';
  end if;

  return current_count <= p_max_attempts;
end;
$_$;


ALTER FUNCTION "public"."consume_public_reservation_rate_limit"("p_key_hash" "text", "p_window_seconds" integer, "p_max_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_reservation_access_records"("target_restaurant_id" "uuid", "target_reservation_id" "uuid", "target_business_email" "text", "target_claim_token_hash" "text", "target_claim_expires_at" timestamp with time zone, "target_manage_token_hash" "text", "target_manage_expires_at" timestamp with time zone) RETURNS TABLE("claim_id" "uuid", "management_token_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
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


ALTER FUNCTION "public"."create_reservation_access_records"("target_restaurant_id" "uuid", "target_reservation_id" "uuid", "target_business_email" "text", "target_claim_token_hash" "text", "target_claim_expires_at" timestamp with time zone, "target_manage_token_hash" "text", "target_manage_expires_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_reservation_access_records"("target_restaurant_id" "uuid", "target_reservation_id" "uuid", "target_business_email" "text", "target_claim_token_hash" "text", "target_claim_expires_at" timestamp with time zone, "target_manage_token_hash" "text", "target_manage_expires_at" timestamp with time zone) IS 'Service-role-only atomic creation of hashed claim and reservation-management bearer records.';



CREATE OR REPLACE FUNCTION "public"."create_workspace_invitation"("target_workspace_id" "uuid", "target_email" "text", "target_role" "text", "target_access_mode" "text" DEFAULT 'all'::"text", "target_selected_restaurant_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "target_token_hash" "text" DEFAULT NULL::"text") RETURNS TABLE("invitation_id" "uuid", "workspace_id" "uuid", "normalized_email" "text", "role" "text", "restaurant_access_mode" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $_$
declare
  current_user_id uuid := auth.uid();
  inviter_role text;
  normalized text := lower(btrim(coalesce(target_email, '')));
  user_limit integer;
  member_count integer;
  pending_count integer;
  selected_count integer;
  existing_invitation uuid;
  new_invitation public.workspace_invitations%rowtype;
  selected_ids uuid[] := coalesce(target_selected_restaurant_ids, '{}'::uuid[]);
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION_TOKEN';
  end if;
  if length(normalized) < 3 or length(normalized) > 320 or position('@' in normalized) < 2 then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION_EMAIL';
  end if;
  if target_role not in ('admin', 'manager', 'staff') then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION_ROLE';
  end if;
  if target_access_mode not in ('all', 'selected') then
    raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_ACCESS_MODE';
  end if;

  select membership.role into inviter_role
  from public.workspace_members as membership
  join public.workspaces as workspace on workspace.id = membership.workspace_id
  where membership.workspace_id = target_workspace_id
    and membership.user_id = current_user_id
    and workspace.status = 'active';

  if inviter_role is null then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_ACCESS_REQUIRED';
  end if;
  if inviter_role not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'TEAM_MANAGEMENT_REQUIRED';
  end if;
  if inviter_role = 'admin' and target_role = 'admin' then
    raise exception using errcode = 'P0001', message = 'ROLE_HIERARCHY_REJECTED';
  end if;

  -- Keep the lock order subscription -> invitation/member state consistent
  -- with membership and restaurant-limit triggers.
  perform 1 from public.workspace_subscriptions as subscription_lock
  where subscription_lock.workspace_id = target_workspace_id
  for update;

  if exists (
    select 1
    from auth.users as auth_user
    join public.workspace_members as member on member.user_id = auth_user.id
    where member.workspace_id = target_workspace_id
      and lower(auth_user.email) = normalized
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_MEMBER';
  end if;

  select invitation.id into existing_invitation
  from public.workspace_invitations as invitation
  where invitation.workspace_id = target_workspace_id
    and invitation.normalized_email = normalized
    and invitation.accepted_at is null
    and invitation.revoked_at is null
  order by invitation.created_at desc
  limit 1
  for update;

  if existing_invitation is not null then
    raise exception using errcode = 'P0001', message = 'INVITATION_ALREADY_PENDING';
  end if;

  select plan.user_limit into user_limit
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key
  where subscription.workspace_id = target_workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');
  if user_limit is null then
    select free_plan.user_limit into user_limit from public.plans as free_plan where free_plan.key = 'free';
  end if;

  select count(*) into member_count
  from public.workspace_members as member_count_row where member_count_row.workspace_id = target_workspace_id;
  select count(*) into pending_count
  from public.workspace_invitations as pending_invitation
  where pending_invitation.workspace_id = target_workspace_id
    and pending_invitation.accepted_at is null and pending_invitation.revoked_at is null and pending_invitation.expires_at > now();

  if user_limit is not null and member_count + pending_count >= user_limit then
    raise exception using errcode = 'P0001', message = 'USER_LIMIT_REACHED', detail = 'USER_LIMIT_REACHED';
  end if;

  if target_role in ('admin', 'owner') then
    target_access_mode := 'all';
    selected_ids := '{}'::uuid[];
  elsif target_access_mode = 'selected' then
    if cardinality(selected_ids) = 0 then
      raise exception using errcode = 'P0001', message = 'RESTAURANT_SELECTION_REQUIRED';
    end if;
    select count(*) into selected_count
    from public.restaurants as selected_restaurant
    where selected_restaurant.workspace_id = target_workspace_id and selected_restaurant.id = any(selected_ids);
    if selected_count <> cardinality(selected_ids) then
      raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_SELECTION';
    end if;
  else
    selected_ids := '{}'::uuid[];
  end if;

  insert into public.workspace_invitations (
    workspace_id, email, normalized_email, role, restaurant_access_mode,
    invited_by, token_hash, expires_at, last_sent_at
  ) values (
    target_workspace_id, btrim(target_email), normalized, target_role,
    target_access_mode, current_user_id, target_token_hash,
    now() + interval '7 days', now()
  ) returning * into new_invitation;

  if target_access_mode = 'selected' then
    insert into public.workspace_invitation_restaurants (invitation_id, restaurant_id)
    select new_invitation.id, selected_id
    from unnest(selected_ids) as selected_id;
  end if;

  return query select new_invitation.id, new_invitation.workspace_id,
    new_invitation.normalized_email, new_invitation.role,
    new_invitation.restaurant_access_mode, new_invitation.expires_at;
end;
$_$;


ALTER FUNCTION "public"."create_workspace_invitation"("target_workspace_id" "uuid", "target_email" "text", "target_role" "text", "target_access_mode" "text", "target_selected_restaurant_ids" "uuid"[], "target_token_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_area_effective_settings"("area_id" "uuid") RETURNS TABLE("opening_time" time without time zone, "closing_time" time without time zone, "time_slot_duration" integer, "max_party_size" integer, "min_party_size" integer, "advance_booking_days" integer, "min_advance_hours" integer, "allowed_days_of_week" integer[])
    LANGUAGE "sql" STABLE
    AS $$
  select
    coalesce(area.opening_time, restaurant.opening_time),
    coalesce(area.closing_time, restaurant.closing_time),
    coalesce(area.time_slot_duration, restaurant.time_slot_duration),
    coalesce(area.max_party_size, restaurant.max_party_size),
    coalesce(area.min_party_size, restaurant.min_party_size),
    coalesce(area.advance_booking_days, restaurant.advance_booking_days),
    coalesce(area.min_advance_hours, restaurant.min_advance_hours),
    coalesce(area.allowed_days_of_week, restaurant.allowed_days_of_week)
  from public.reservation_areas area
  join public.restaurants restaurant on restaurant.id = area.restaurant_id
  where area.id = get_area_effective_settings.area_id;
$$;


ALTER FUNCTION "public"."get_area_effective_settings"("area_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_stats"("p_restaurant_id" "uuid" DEFAULT NULL::"uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS TABLE("total" bigint, "pending" bigint, "confirmed" bigint, "cancelled" bigint, "percent_change" integer, "total_kuver" bigint, "total_meal_reservations" bigint, "deck_kuvers" bigint, "terrace_kuvers" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with scoped as (
    select r.status, r.party_size, r.reservation_type, area.name as area_name
    from public.reservations r
    left join public.reservation_areas area on area.id = r.reservation_area_id
    where (p_restaurant_id is null or r.restaurant_id = p_restaurant_id)
      and (p_start_date is null or r.reservation_date >= p_start_date)
      and (p_end_date is null or r.reservation_date <= p_end_date)
  ), current_counts as (
    select
      count(*) as total,
      count(*) filter (where coalesce(status, 'pending') = 'pending') as pending,
      count(*) filter (where status = 'confirmed') as confirmed,
      count(*) filter (where status = 'cancelled') as cancelled,
      coalesce(sum(party_size) filter (where status = 'confirmed'), 0) as total_kuver,
      count(*) filter (where reservation_type = 'meal') as total_meal_reservations,
      coalesce(sum(party_size) filter (where status = 'confirmed' and coalesce(area_name, '') ilike '%deck%'), 0) as deck_kuvers,
      coalesce(sum(party_size) filter (where status = 'confirmed' and coalesce(area_name, '') ilike '%terrace%'), 0) as terrace_kuvers
    from scoped
  ), comparison as (
    select
      count(*) filter (where r.created_at >= now() - interval '1 month' and r.created_at < now()) as last_month_count,
      count(*) filter (where r.created_at >= now() - interval '2 months' and r.created_at < now() - interval '1 month') as two_months_ago_count
    from public.reservations r
    where (p_restaurant_id is null or r.restaurant_id = p_restaurant_id)
  )
  select
    current_counts.total,
    current_counts.pending,
    current_counts.confirmed,
    current_counts.cancelled,
    case when comparison.two_months_ago_count > 0 then round(((comparison.last_month_count - comparison.two_months_ago_count)::numeric / comparison.two_months_ago_count::numeric) * 100)::integer else 0 end,
    current_counts.total_kuver,
    current_counts.total_meal_reservations,
    current_counts.deck_kuvers,
    current_counts.terrace_kuvers
  from current_counts, comparison;
$$;


ALTER FUNCTION "public"."get_dashboard_stats"("p_restaurant_id" "uuid", "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[], "target_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select case
    when auth.uid() is not null and target_user_id is distinct from auth.uid() then false
    else exists (
      select 1
      from public.workspace_members as membership
      join public.workspaces as workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = target_workspace_id
        and membership.user_id = target_user_id
        and membership.role = any(allowed_roles)
        and workspace.status = 'active'
    )
  end;
$$;


ALTER FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[], "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_workspace_member"("target_workspace_id" "uuid", "target_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select case
    when auth.uid() is not null and target_user_id is distinct from auth.uid() then false
    else exists (
      select 1
      from public.workspace_members as membership
      join public.workspaces as workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = target_workspace_id
        and membership.user_id = target_user_id
        and workspace.status = 'active'
    )
  end;
$$;


ALTER FUNCTION "public"."is_workspace_member"("target_workspace_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_restaurant_workspace"("target_restaurant_name" "text", "target_workspace_name" "text" DEFAULT NULL::"text", "target_restaurant_slug" "text" DEFAULT NULL::"text", "target_workspace_id" "uuid" DEFAULT NULL::"uuid", "target_owner_user_id" "uuid" DEFAULT NULL::"uuid", "target_restaurant_status" "text" DEFAULT 'unpublished'::"text", "target_claim_status" "text" DEFAULT 'claimed'::"text", "target_source" "text" DEFAULT 'self_service'::"text", "target_business_contact_email" "text" DEFAULT NULL::"text", "target_official_website_url" "text" DEFAULT NULL::"text", "target_official_domain" "text" DEFAULT NULL::"text", "target_source_import_id" "uuid" DEFAULT NULL::"uuid", "target_profile" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("workspace_id" "uuid", "restaurant_id" "uuid", "workspace_slug" "text", "restaurant_slug" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
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


ALTER FUNCTION "public"."provision_restaurant_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text", "target_workspace_id" "uuid", "target_owner_user_id" "uuid", "target_restaurant_status" "text", "target_claim_status" "text", "target_source" "text", "target_business_contact_email" "text", "target_official_website_url" "text", "target_official_domain" "text", "target_source_import_id" "uuid", "target_profile" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."provision_restaurant_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text", "target_workspace_id" "uuid", "target_owner_user_id" "uuid", "target_restaurant_status" "text", "target_claim_status" "text", "target_source" "text", "target_business_contact_email" "text", "target_official_website_url" "text", "target_official_domain" "text", "target_source_import_id" "uuid", "target_profile" "jsonb") IS 'Service-role-only atomic provisioning for self-service-compatible and platform-created restaurant workspaces.';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_platform_restaurant_from_import"("target_restaurant_id" "uuid", "target_payload" "jsonb", "target_provided_fields" "text"[] DEFAULT NULL::"text"[]) RETURNS TABLE("restaurant_id" "uuid", "workspace_id" "uuid", "restaurant_slug" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select * from private.update_platform_restaurant_from_import(
    target_restaurant_id,
    target_payload,
    target_provided_fields
  );
$$;


ALTER FUNCTION "public"."update_platform_restaurant_from_import"("target_restaurant_id" "uuid", "target_payload" "jsonb", "target_provided_fields" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_workspace_member"("target_workspace_id" "uuid", "target_member_id" "uuid", "target_role" "text", "target_access_mode" "text" DEFAULT 'all'::"text", "target_selected_restaurant_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS TABLE("member_id" "uuid", "role" "text", "restaurant_access_mode" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  current_user_id uuid := auth.uid();
  actor_role text;
  target_member public.workspace_members%rowtype;
  selected_ids uuid[] := coalesce(target_selected_restaurant_ids, '{}'::uuid[]);
  selected_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if target_role not in ('admin', 'manager', 'staff') then
    raise exception using errcode = 'P0001', message = 'ROLE_HIERARCHY_REJECTED';
  end if;
  if target_access_mode not in ('all', 'selected') then
    raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_ACCESS_MODE';
  end if;

  select *
    into target_member
  from public.workspace_members
  where id = target_member_id
    and workspace_id = target_workspace_id
  for update;

  if target_member.id is null then
    raise exception using errcode = 'P0001', message = 'MEMBER_NOT_FOUND';
  end if;

  select member.role
    into actor_role
  from public.workspace_members as member
  join public.workspaces as workspace on workspace.id = member.workspace_id
  where member.user_id = current_user_id
    and member.workspace_id = target_member.workspace_id
    and workspace.status = 'active'
    and member.role in ('owner', 'admin')
  order by case when member.role = 'owner' then 0 else 1 end
  limit 1;

  if actor_role is null then
    raise exception using errcode = 'P0001', message = 'TEAM_MANAGEMENT_REQUIRED';
  end if;

  if target_member.role = 'owner' then
    raise exception using errcode = 'P0001', message = 'OWNER_PROTECTED';
  end if;
  if actor_role = 'admin' and (target_member.role = 'admin' or target_role = 'admin') then
    raise exception using errcode = 'P0001', message = 'ROLE_HIERARCHY_REJECTED';
  end if;

  if target_role = 'admin' then
    target_access_mode := 'all';
    selected_ids := '{}'::uuid[];
  elsif target_access_mode = 'selected' then
    if cardinality(selected_ids) = 0 then
      raise exception using errcode = 'P0001', message = 'RESTAURANT_SELECTION_REQUIRED';
    end if;
    select count(*)
      into selected_count
    from public.restaurants as restaurant
    where restaurant.workspace_id = target_member.workspace_id
      and restaurant.id = any(selected_ids);
    if selected_count <> cardinality(selected_ids) then
      raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_SELECTION';
    end if;
  else
    selected_ids := '{}'::uuid[];
  end if;

  update public.workspace_members
  set role = target_role,
      restaurant_access_mode = target_access_mode,
      updated_at = now()
  where id = target_member.id;

  delete from public.workspace_member_restaurants as assignment
  where assignment.member_id = target_member.id;

  if target_access_mode = 'selected' then
    insert into public.workspace_member_restaurants (member_id, restaurant_id)
    select target_member.id, selected_id
    from unnest(selected_ids) as selected_id;
  end if;

  return query select target_member.id, target_role, target_access_mode;
end;
$$;


ALTER FUNCTION "public"."update_workspace_member"("target_workspace_id" "uuid", "target_member_id" "uuid", "target_role" "text", "target_access_mode" "text", "target_selected_restaurant_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_reservation_type"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if exists (
    select 1 from public.restaurants
    where id = new.restaurant_id
      and meal_only_reservations = true
      and new.reservation_type = 'drinks'
  ) then
    raise exception 'This restaurant only accepts meal reservations';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_reservation_type"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'staff'::"text" NOT NULL,
    "restaurant_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'staff'::"text", 'readonly'::"text"])))
);


ALTER TABLE "public"."admin_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."admin_profiles" IS 'Legacy profile metadata and compatibility source during migration. Workspace authorization is authoritative in workspace_members.';



CREATE TABLE IF NOT EXISTS "public"."admin_push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid",
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_checkout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'paddle'::"text" NOT NULL,
    "environment" "text" NOT NULL,
    "target_plan_key" "text" NOT NULL,
    "provider_price_id" "text" NOT NULL,
    "provider_transaction_id" "text",
    "idempotency_key" "text" NOT NULL,
    "status" "text" DEFAULT 'created'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_checkout_sessions_environment_check" CHECK (("environment" = ANY (ARRAY['sandbox'::"text", 'live'::"text"]))),
    CONSTRAINT "billing_checkout_sessions_paid_plan_check" CHECK (("target_plan_key" = ANY (ARRAY['starter'::"text", 'pro'::"text", 'business'::"text"]))),
    CONSTRAINT "billing_checkout_sessions_provider_check" CHECK (("provider" = 'paddle'::"text")),
    CONSTRAINT "billing_checkout_sessions_status_check" CHECK (("status" = ANY (ARRAY['created'::"text", 'completed'::"text", 'expired'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."billing_checkout_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."billing_checkout_sessions" IS 'Server-created checkout requests used for workspace/idempotency tracking; never a source of paid entitlements.';



CREATE TABLE IF NOT EXISTS "public"."billing_provider_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "plan_key" "text" NOT NULL,
    "provider_product_id" "text" NOT NULL,
    "provider_price_id" "text" NOT NULL,
    "billing_interval" "text" DEFAULT 'month'::"text" NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_provider_prices_billing_interval_check" CHECK (("billing_interval" = ANY (ARRAY['month'::"text", 'year'::"text"]))),
    CONSTRAINT "billing_provider_prices_currency_check" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "billing_provider_prices_environment_check" CHECK (("environment" = ANY (ARRAY['sandbox'::"text", 'live'::"text"]))),
    CONSTRAINT "billing_provider_prices_paid_plan_check" CHECK (("plan_key" = ANY (ARRAY['starter'::"text", 'pro'::"text", 'business'::"text"]))),
    CONSTRAINT "billing_provider_prices_provider_check" CHECK (("provider" = 'paddle'::"text")),
    CONSTRAINT "billing_provider_prices_provider_price_id_check" CHECK (("length"(TRIM(BOTH FROM "provider_price_id")) > 0)),
    CONSTRAINT "billing_provider_prices_provider_product_id_check" CHECK (("length"(TRIM(BOTH FROM "provider_product_id")) > 0))
);


ALTER TABLE "public"."billing_provider_prices" OWNER TO "postgres";


COMMENT ON TABLE "public"."billing_provider_prices" IS 'Environment-specific Paddle product/price mapping. Server-controlled; Free has no mapping.';



CREATE TABLE IF NOT EXISTS "public"."billing_mutations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "request_key" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "fingerprint" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_mutations_operation_check" CHECK (("operation" = ANY (ARRAY['checkout'::text, 'plan_change'::text, 'cancel'::text, 'resume'::text, 'payment_recovery'::text]))),
    CONSTRAINT "billing_mutations_status_check" CHECK (("status" = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'unknown'::text]))),
    CONSTRAINT "billing_mutations_request_key_check" CHECK ((length(TRIM(BOTH FROM "request_key")) >= 16 AND length(TRIM(BOTH FROM "request_key")) <= 100)),
    CONSTRAINT "billing_mutations_result_check" CHECK ((jsonb_typeof("result") = 'object'::text))
);


ALTER TABLE "public"."billing_mutations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_cancellation_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "provider_subscription_id" "text",
    "reason_code" "text" NOT NULL,
    "feedback" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_cancellation_feedback_reason_check" CHECK (("reason_code" = ANY (ARRAY['too_expensive'::text, 'not_using'::text, 'seasonal'::text, 'missing_feature'::text, 'technical_problem'::text, 'switching_solution'::text, 'other'::text))),
    CONSTRAINT "billing_cancellation_feedback_length_check" CHECK (("feedback" IS NULL OR length("feedback") <= 1000))
);


ALTER TABLE "public"."billing_cancellation_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "provider_object_id" "text",
    "workspace_id" "uuid",
    "status" "text" DEFAULT 'received'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "processing_started_at" timestamp with time zone,
    "error_code" "text",
    "error_message" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    CONSTRAINT "billing_webhook_events_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "billing_webhook_events_payload_check" CHECK (("jsonb_typeof"("payload") = 'object'::"text")),
    CONSTRAINT "billing_webhook_events_provider_check" CHECK (("provider" = 'paddle'::"text")),
    CONSTRAINT "billing_webhook_events_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'processing'::"text", 'processed'::"text", 'ignored'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."billing_webhook_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."billing_webhook_events" IS 'Minimal durable Paddle webhook inbox. Payloads are normalized and intentionally exclude raw payment details.';



CREATE TABLE IF NOT EXISTS "public"."notification_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "email_notifications" boolean DEFAULT true NOT NULL,
    "sms_notifications" boolean DEFAULT false NOT NULL,
    "notification_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plans" (
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "monthly_price_usd_cents" integer NOT NULL,
    "sort_order" integer NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "restaurant_limit" integer NOT NULL,
    "user_limit" integer NOT NULL,
    "reservation_limit" integer,
    "history_days" integer,
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plans_features_check" CHECK (("jsonb_typeof"("features") = 'object'::"text")),
    CONSTRAINT "plans_history_days_check" CHECK ((("history_days" IS NULL) OR ("history_days" > 0))),
    CONSTRAINT "plans_key_check" CHECK (("key" = ANY (ARRAY['free'::"text", 'starter'::"text", 'pro'::"text", 'business'::"text"]))),
    CONSTRAINT "plans_monthly_price_usd_cents_check" CHECK (("monthly_price_usd_cents" >= 0)),
    CONSTRAINT "plans_reservation_limit_check" CHECK ((("reservation_limit" IS NULL) OR ("reservation_limit" > 0))),
    CONSTRAINT "plans_restaurant_limit_check" CHECK (("restaurant_limit" > 0)),
    CONSTRAINT "plans_sort_order_check" CHECK (("sort_order" >= 0)),
    CONSTRAINT "plans_user_limit_check" CHECK (("user_limit" > 0))
);


ALTER TABLE "public"."plans" OWNER TO "postgres";


COMMENT ON TABLE "public"."plans" IS 'Reservevia commercial catalog. Numeric limits and feature capabilities are database-owned.';



CREATE TABLE IF NOT EXISTS "public"."platform_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_user_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "text",
    "before_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "after_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_audit_logs_action_check" CHECK (("length"("btrim"("action")) > 0)),
    CONSTRAINT "platform_audit_logs_after_data_check" CHECK (("jsonb_typeof"("after_data") = 'object'::"text")),
    CONSTRAINT "platform_audit_logs_before_data_check" CHECK (("jsonb_typeof"("before_data") = 'object'::"text")),
    CONSTRAINT "platform_audit_logs_entity_type_check" CHECK (("length"("btrim"("entity_type")) > 0)),
    CONSTRAINT "platform_audit_logs_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text"))
);


ALTER TABLE "public"."platform_audit_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_audit_logs" IS 'Immutable-by-convention audit trail for platform administration actions.';



CREATE TABLE IF NOT EXISTS "public"."platform_members" (
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_members_role_check" CHECK (("role" = ANY (ARRAY['platform_owner'::"text", 'platform_admin'::"text", 'billing_admin'::"text", 'support'::"text", 'auditor'::"text"]))),
    CONSTRAINT "platform_members_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."platform_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_members" IS 'Reservevia platform staff roles. Separate from workspace membership and server-controlled.';



CREATE TABLE IF NOT EXISTS "public"."platform_restaurant_import_rows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "import_id" "uuid" NOT NULL,
    "excel_row_number" integer NOT NULL,
    "normalized_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "validation_status" "text" NOT NULL,
    "validation_messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "row_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "restaurant_id" "uuid",
    "failure_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_restaurant_import_rows_excel_row_number_check" CHECK (("excel_row_number" >= 2)),
    CONSTRAINT "platform_restaurant_import_rows_normalized_payload_check" CHECK (("jsonb_typeof"("normalized_payload") = 'object'::"text")),
    CONSTRAINT "platform_restaurant_import_rows_row_status_check" CHECK (("row_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'created'::"text", 'updated'::"text", 'skipped'::"text", 'failed'::"text"]))),
    CONSTRAINT "platform_restaurant_import_rows_validation_messages_check" CHECK (("jsonb_typeof"("validation_messages") = 'array'::"text")),
    CONSTRAINT "platform_restaurant_import_rows_validation_status_check" CHECK (("validation_status" = ANY (ARRAY['ready'::"text", 'warning'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."platform_restaurant_import_rows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_restaurant_imports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "original_filename" "text" NOT NULL,
    "total_rows" integer DEFAULT 0 NOT NULL,
    "ready_rows" integer DEFAULT 0 NOT NULL,
    "warning_rows" integer DEFAULT 0 NOT NULL,
    "invalid_rows" integer DEFAULT 0 NOT NULL,
    "created_rows" integer DEFAULT 0 NOT NULL,
    "failed_rows" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'preview'::"text" NOT NULL,
    "processing_started_at" timestamp with time zone,
    "summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mode" "text" DEFAULT 'create'::"text" NOT NULL,
    "updated_rows" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "platform_restaurant_imports_created_rows_check" CHECK (("created_rows" >= 0)),
    CONSTRAINT "platform_restaurant_imports_failed_rows_check" CHECK (("failed_rows" >= 0)),
    CONSTRAINT "platform_restaurant_imports_invalid_rows_check" CHECK (("invalid_rows" >= 0)),
    CONSTRAINT "platform_restaurant_imports_mode_check" CHECK (("mode" = ANY (ARRAY['create'::"text", 'update'::"text"]))),
    CONSTRAINT "platform_restaurant_imports_original_filename_check" CHECK ((("length"("btrim"("original_filename")) > 0) AND ("length"("original_filename") <= 255))),
    CONSTRAINT "platform_restaurant_imports_ready_rows_check" CHECK (("ready_rows" >= 0)),
    CONSTRAINT "platform_restaurant_imports_status_check" CHECK (("status" = ANY (ARRAY['preview'::"text", 'confirming'::"text", 'completed'::"text", 'partial'::"text", 'failed'::"text", 'expired'::"text"]))),
    CONSTRAINT "platform_restaurant_imports_summary_check" CHECK (("jsonb_typeof"("summary") = 'object'::"text")),
    CONSTRAINT "platform_restaurant_imports_total_rows_check" CHECK (("total_rows" >= 0)),
    CONSTRAINT "platform_restaurant_imports_updated_rows_check" CHECK (("updated_rows" >= 0)),
    CONSTRAINT "platform_restaurant_imports_warning_rows_check" CHECK (("warning_rows" >= 0))
);


ALTER TABLE "public"."platform_restaurant_imports" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_restaurant_imports" IS 'Private server-validated platform import batches; client preview is never authoritative.';



CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_settings_key_check" CHECK (("key" = ANY (ARRAY['maintenance_mode'::"text", 'maintenance_message'::"text", 'signup_enabled'::"text", 'support_email'::"text", 'default_locale'::"text", 'default_timezone'::"text"])))
);


ALTER TABLE "public"."platform_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_settings" IS 'Non-secret platform settings only. Secrets remain deployment environment variables.';



CREATE TABLE IF NOT EXISTS "public"."platform_user_controls" (
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "reason" "text",
    "suspended_by" "uuid",
    "suspended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_user_controls_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."platform_user_controls" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_user_controls" IS 'Platform-level user suspension state. Suspension is separate from authentication deletion.';



CREATE TABLE IF NOT EXISTS "public"."platform_user_directory" (
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "last_sign_in_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_user_directory" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_user_directory" IS 'Server-controlled safe identity projection used by Platform Control search and bounded admin lists.';



CREATE TABLE IF NOT EXISTS "public"."public_reservation_rate_limits" (
    "key_hash" "text" NOT NULL,
    "window_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "public_reservation_rate_limits_attempt_count_check" CHECK (("attempt_count" > 0)),
    CONSTRAINT "public_reservation_rate_limits_key_hash_check" CHECK (("key_hash" ~ '^[a-f0-9]{64}$'::"text"))
);


ALTER TABLE "public"."public_reservation_rate_limits" OWNER TO "postgres";


COMMENT ON TABLE "public"."public_reservation_rate_limits" IS 'Short-lived hashed counters for public reservation abuse protection; raw client identifiers are never stored.';



CREATE TABLE IF NOT EXISTS "public"."reservation_areas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "opening_time" time without time zone,
    "closing_time" time without time zone,
    "time_slot_duration" integer,
    "max_party_size" integer,
    "min_party_size" integer,
    "advance_booking_days" integer,
    "min_advance_hours" integer,
    "allowed_days_of_week" integer[],
    "blocked_dates" "date"[] DEFAULT '{}'::"date"[] NOT NULL,
    "special_hours" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "max_concurrent_reservations" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reservation_areas_advance_booking_days_check" CHECK ((("advance_booking_days" IS NULL) OR (("advance_booking_days" >= 0) AND ("advance_booking_days" <= 365)))),
    CONSTRAINT "reservation_areas_display_order_check" CHECK (("display_order" >= 0)),
    CONSTRAINT "reservation_areas_max_concurrent_check" CHECK ((("max_concurrent_reservations" IS NULL) OR ("max_concurrent_reservations" > 0))),
    CONSTRAINT "reservation_areas_min_advance_hours_check" CHECK ((("min_advance_hours" IS NULL) OR (("min_advance_hours" >= 0) AND ("min_advance_hours" <= 168)))),
    CONSTRAINT "reservation_areas_party_size_range_check" CHECK (((("min_party_size" IS NULL) AND ("max_party_size" IS NULL)) OR (("min_party_size" IS NOT NULL) AND ("max_party_size" IS NOT NULL) AND ("min_party_size" > 0) AND ("max_party_size" >= "min_party_size")))),
    CONSTRAINT "reservation_areas_time_slot_duration_check" CHECK ((("time_slot_duration" IS NULL) OR (("time_slot_duration" > 0) AND ("time_slot_duration" <= 240))))
);


ALTER TABLE "public"."reservation_areas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reservation_management_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reservation_management_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."reservation_management_tokens" IS 'Private hashed bearer tokens for accountless business reservation management.';



CREATE TABLE IF NOT EXISTS "public"."reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "reservation_area_id" "uuid",
    "customer_name" "text" NOT NULL,
    "customer_phone" "text" NOT NULL,
    "customer_email" "text",
    "party_size" integer NOT NULL,
    "reservation_date" "date" NOT NULL,
    "reservation_time" time without time zone NOT NULL,
    "special_requests" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "notes" "text",
    "table_number" "text",
    "reservation_type" "text" DEFAULT 'meal'::"text",
    "booking_source" "text" DEFAULT 'online'::"text" NOT NULL,
    "booked_by_user_id" "uuid",
    "booked_by_label" "text",
    "last_update_summary" "jsonb",
    "last_updated_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "public_submission_id" "text",
    CONSTRAINT "reservations_party_size_check" CHECK (("party_size" > 0)),
    CONSTRAINT "reservations_public_submission_id_check" CHECK ((("public_submission_id" IS NULL) OR ("public_submission_id" ~ '^[A-Za-z0-9_-]{16,100}$'::"text"))),
    CONSTRAINT "reservations_reservation_type_check" CHECK (("reservation_type" = ANY (ARRAY['meal'::"text", 'drinks'::"text"]))),
    CONSTRAINT "reservations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."reservations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."reservations"."public_submission_id" IS 'Optional client-generated idempotency key for public reservation retries, scoped to a restaurant.';



CREATE TABLE IF NOT EXISTS "public"."restaurant_claim_profiles" (
    "restaurant_id" "uuid" NOT NULL,
    "ownership_status" "text" DEFAULT 'claimed'::"text" NOT NULL,
    "source" "text" DEFAULT 'legacy'::"text" NOT NULL,
    "business_contact_email" "text",
    "normalized_business_contact_email" "text",
    "official_website_url" "text",
    "official_domain" "text",
    "claimed_by_user_id" "uuid",
    "claimed_at" timestamp with time zone,
    "source_import_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "restaurant_claim_profiles_domain_length" CHECK ((("official_domain" IS NULL) OR ("length"("btrim"("official_domain")) <= 253))),
    CONSTRAINT "restaurant_claim_profiles_email_length" CHECK ((("business_contact_email" IS NULL) OR ("length"("btrim"("business_contact_email")) <= 320))),
    CONSTRAINT "restaurant_claim_profiles_ownership_status_check" CHECK (("ownership_status" = ANY (ARRAY['unclaimed'::"text", 'claim_pending'::"text", 'claimed'::"text"]))),
    CONSTRAINT "restaurant_claim_profiles_source_check" CHECK (("source" = ANY (ARRAY['platform_manual'::"text", 'platform_excel'::"text", 'self_service'::"text", 'legacy'::"text"])))
);


ALTER TABLE "public"."restaurant_claim_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."restaurant_claim_profiles" IS 'Private ownership and business-contact projection. Never exposed to anonymous or ordinary authenticated reads.';



CREATE TABLE IF NOT EXISTS "public"."restaurant_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "reservation_id" "uuid",
    "claimant_user_id" "uuid",
    "requested_email" "text",
    "verified_email" "text",
    "verification_method" "text" DEFAULT 'manual_review'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "token_hash" "text",
    "expires_at" timestamp with time zone,
    "approved_by_user_id" "uuid",
    "approved_at" timestamp with time zone,
    "rejected_by_user_id" "uuid",
    "rejected_at" timestamp with time zone,
    "consumed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "restaurant_claims_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "restaurant_claims_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'approved'::"text", 'rejected'::"text", 'expired'::"text", 'consumed'::"text"]))),
    CONSTRAINT "restaurant_claims_verification_method_check" CHECK (("verification_method" = ANY (ARRAY['token'::"text", 'exact_email'::"text", 'official_domain'::"text", 'manual_review'::"text"])))
);


ALTER TABLE "public"."restaurant_claims" OWNER TO "postgres";


COMMENT ON TABLE "public"."restaurant_claims" IS 'Private claim requests and hashed claim bearer tokens.';



CREATE TABLE IF NOT EXISTS "public"."restaurant_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "hostname" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "provider" "text" DEFAULT 'vercel'::"text" NOT NULL,
    "provider_environment" "text" DEFAULT 'production'::"text" NOT NULL,
    "verification_state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "provider_verified" boolean DEFAULT false NOT NULL,
    "dns_configured" boolean DEFAULT false NOT NULL,
    "verified_at" timestamp with time zone,
    "last_checked_at" timestamp with time zone,
    "last_error_code" "text",
    "last_error_message" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "restaurant_domains_hostname_lowercase" CHECK (("hostname" = "lower"("hostname"))),
    CONSTRAINT "restaurant_domains_hostname_not_blank" CHECK (("length"("btrim"("hostname")) > 0)),
    CONSTRAINT "restaurant_domains_provider_check" CHECK (("provider" = 'vercel'::"text")),
    CONSTRAINT "restaurant_domains_provider_environment_check" CHECK (("provider_environment" = ANY (ARRAY['production'::"text", 'preview'::"text"]))),
    CONSTRAINT "restaurant_domains_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'verifying'::"text", 'active'::"text", 'error'::"text", 'removing'::"text", 'suspended'::"text", 'removed'::"text"]))),
    CONSTRAINT "restaurant_domains_verification_state_check" CHECK (("verification_state" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'failed'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."restaurant_domains" OWNER TO "postgres";


COMMENT ON TABLE "public"."restaurant_domains" IS 'Customer-owned custom domains. Hosted slug.reservevia.com URLs are derived from restaurants.slug and are not stored here.';



COMMENT ON COLUMN "public"."restaurant_domains"."hostname" IS 'Normalized lowercase ASCII/punycode hostname without scheme, path, query, fragment, or port.';



COMMENT ON COLUMN "public"."restaurant_domains"."status" IS 'Local lifecycle state; active requires verified provider configuration and an entitled workspace.';



COMMENT ON COLUMN "public"."restaurant_domains"."provider_verified" IS 'Server/provider-controlled verification result. Never writable through the browser Data API.';



COMMENT ON COLUMN "public"."restaurant_domains"."dns_configured" IS 'Server/provider-controlled DNS and certificate readiness result.';



CREATE TABLE IF NOT EXISTS "public"."restaurant_media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "media_url" "text" NOT NULL,
    "media_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."restaurant_media" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "cuisine" "text",
    "hours" "text",
    "atmosphere" "text",
    "phone" "text",
    "location" "text",
    "media_type" "text" DEFAULT 'slideshow'::"text",
    "reservation_enabled" boolean DEFAULT true NOT NULL,
    "allowed_days_of_week" integer[] DEFAULT '{1,2,3,4,5,6,7}'::integer[] NOT NULL,
    "opening_time" time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    "closing_time" time without time zone DEFAULT '22:00:00'::time without time zone NOT NULL,
    "time_slot_duration" integer DEFAULT 30 NOT NULL,
    "advance_booking_days" integer DEFAULT 30 NOT NULL,
    "min_advance_hours" integer DEFAULT 2 NOT NULL,
    "max_party_size" integer DEFAULT 12 NOT NULL,
    "min_party_size" integer DEFAULT 1 NOT NULL,
    "reservation_start_date" "date",
    "reservation_blocked_intervals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "reservation_notices" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "blocked_dates" "date"[] DEFAULT '{}'::"date"[] NOT NULL,
    "special_hours" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "meal_only_reservations" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "logo_url" "text",
    "primary_image_url" "text",
    "whatsapp" "text",
    "menu_url" "text",
    "location_url" "text",
    "events_url" "text",
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "status" "text" DEFAULT 'published'::"text" NOT NULL,
    "platform_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "social_links" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "profile_visibility" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "discovery_score" integer GENERATED ALWAYS AS (((
        CASE WHEN (NULLIF(BTRIM("primary_image_url"), ''::"text") IS NOT NULL) THEN 4 ELSE 0 END
        + CASE WHEN (NULLIF(BTRIM("description"), ''::"text") IS NOT NULL) THEN 2 ELSE 0 END
        + CASE WHEN (NULLIF(BTRIM("logo_url"), ''::"text") IS NOT NULL) THEN 1 ELSE 0 END
        + CASE WHEN (NULLIF(BTRIM("cuisine"), ''::"text") IS NOT NULL) THEN 1 ELSE 0 END
        + CASE WHEN (NULLIF(BTRIM("atmosphere"), ''::"text") IS NOT NULL) THEN 1 ELSE 0 END
        + CASE WHEN (NULLIF(BTRIM("hours"), ''::"text") IS NOT NULL) THEN 1 ELSE 0 END
        + CASE WHEN (NULLIF(BTRIM("location"), ''::"text") IS NOT NULL) THEN 1 ELSE 0 END
        + CASE WHEN (NULLIF(BTRIM("menu_url"), ''::"text") IS NOT NULL) THEN 1 ELSE 0 END
      )) STORED,
    CONSTRAINT "restaurants_advance_booking_days_check" CHECK ((("advance_booking_days" >= 0) AND ("advance_booking_days" <= 365))),
    CONSTRAINT "restaurants_allowed_days_check" CHECK ((("cardinality"("allowed_days_of_week") > 0) AND ("allowed_days_of_week" <@ '{1,2,3,4,5,6,7}'::integer[]))),
    CONSTRAINT "restaurants_media_type_check" CHECK ((("media_type" IS NULL) OR ("media_type" = ANY (ARRAY['slideshow'::"text", 'video'::"text"])))),
    CONSTRAINT "restaurants_min_advance_hours_check" CHECK ((("min_advance_hours" >= 0) AND ("min_advance_hours" <= 168))),
    CONSTRAINT "restaurants_opening_closing_time_check" CHECK (("opening_time" < "closing_time")),
    CONSTRAINT "restaurants_party_size_range_check" CHECK ((("min_party_size" > 0) AND ("max_party_size" >= "min_party_size"))),
    CONSTRAINT "restaurants_platform_status_check" CHECK (("platform_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'archived'::"text"]))),
    CONSTRAINT "restaurants_profile_visibility_object_check" CHECK (("jsonb_typeof"("profile_visibility") = 'object'::"text")),
    CONSTRAINT "restaurants_public_status_check" CHECK (("status" = ANY (ARRAY['published'::"text", 'unpublished'::"text"]))),
    CONSTRAINT "restaurants_social_links_object_check" CHECK (("jsonb_typeof"("social_links") = 'object'::"text")),
    CONSTRAINT "restaurants_time_slot_duration_check" CHECK ((("time_slot_duration" > 0) AND ("time_slot_duration" <= 240)))
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


CREATE INDEX IF NOT EXISTS "restaurants_public_discovery_order_idx"
  ON "public"."restaurants" ("discovery_score" DESC, "updated_at" DESC, "name" ASC, "id" ASC)
  WHERE (("status" = 'published'::"text") AND ("platform_status" = 'active'::"text") AND ("reservation_enabled" = true));


CREATE INDEX IF NOT EXISTS "restaurants_public_name_trgm_idx"
  ON "public"."restaurants" USING gin ("name" "public"."gin_trgm_ops")
  WHERE (("status" = 'published'::"text") AND ("platform_status" = 'active'::"text") AND ("reservation_enabled" = true));


CREATE INDEX IF NOT EXISTS "restaurants_public_cuisine_trgm_idx"
  ON "public"."restaurants" USING gin ("cuisine" "public"."gin_trgm_ops")
  WHERE (("status" = 'published'::"text") AND ("platform_status" = 'active'::"text") AND ("reservation_enabled" = true));


CREATE INDEX IF NOT EXISTS "restaurants_public_atmosphere_trgm_idx"
  ON "public"."restaurants" USING gin ("atmosphere" "public"."gin_trgm_ops")
  WHERE (("status" = 'published'::"text") AND ("platform_status" = 'active'::"text") AND ("reservation_enabled" = true));


CREATE INDEX IF NOT EXISTS "restaurants_public_location_trgm_idx"
  ON "public"."restaurants" USING gin ("location" "public"."gin_trgm_ops")
  WHERE (("status" = 'published'::"text") AND ("platform_status" = 'active'::"text") AND ("reservation_enabled" = true));


COMMENT ON COLUMN "public"."restaurants"."workspace_id" IS 'Additive tenant ownership. Historical rows are assigned by the next forward migration before this becomes required.';



COMMENT ON COLUMN "public"."restaurants"."slug" IS 'Stable globally unique public identifier. Name changes must not silently change it.';



COMMENT ON COLUMN "public"."restaurants"."logo_url" IS 'One public restaurant logo asset URL.';



COMMENT ON COLUMN "public"."restaurants"."primary_image_url" IS 'One public restaurant primary/banner image URL. Galleries remain legacy compatibility only.';



COMMENT ON COLUMN "public"."restaurants"."status" IS 'Public profile publication state. Unpublished restaurants have no public profile route.';



COMMENT ON COLUMN "public"."restaurants"."platform_status" IS 'Platform moderation state; restaurant.status remains the public publishing state.';


COMMENT ON COLUMN "public"."restaurants"."discovery_score" IS 'Computed public discovery quality score. It is not a manual promotion control.';



COMMENT ON COLUMN "public"."restaurants"."social_links" IS 'Validated public social profile URLs keyed by platform, for example instagram or facebook.';



COMMENT ON COLUMN "public"."restaurants"."profile_visibility" IS 'Optional per-field public profile visibility flags. Missing keys use the default visible state.';



CREATE TABLE IF NOT EXISTS "public"."subscription_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "plan_key" "text" NOT NULL,
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "effective_until" timestamp with time zone,
    "reason" "text" NOT NULL,
    "created_by" "uuid",
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscription_overrides_period_check" CHECK ((("effective_until" IS NULL) OR ("effective_until" > "effective_from"))),
    CONSTRAINT "subscription_overrides_reason_check" CHECK (("length"("btrim"("reason")) > 0))
);


ALTER TABLE "public"."subscription_overrides" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscription_overrides" IS 'Temporary or manual entitlement overrides; Paddle subscription state remains untouched.';



CREATE TABLE IF NOT EXISTS "public"."workspace_invitation_restaurants" (
    "invitation_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspace_invitation_restaurants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "normalized_email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "restaurant_access_mode" "text" DEFAULT 'all'::"text" NOT NULL,
    "invited_by" "uuid",
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "last_sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email_delivery_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "delivery_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspace_invitations_email_check" CHECK ((("length"("normalized_email") >= 3) AND ("length"("normalized_email") <= 320))),
    CONSTRAINT "workspace_invitations_email_delivery_status_check" CHECK (("email_delivery_status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "workspace_invitations_normalized_email_check" CHECK (("normalized_email" = "lower"("btrim"("normalized_email")))),
    CONSTRAINT "workspace_invitations_restaurant_access_mode_check" CHECK (("restaurant_access_mode" = ANY (ARRAY['all'::"text", 'selected'::"text"]))),
    CONSTRAINT "workspace_invitations_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'staff'::"text"]))),
    CONSTRAINT "workspace_invitations_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "public"."workspace_invitations" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_invitations" IS 'Hashed, expiring team invitations. Pending valid rows reserve user seats.';



CREATE TABLE IF NOT EXISTS "public"."workspace_member_restaurants" (
    "member_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspace_member_restaurants" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_member_restaurants" IS 'Normalized selected restaurant access for workspace members.';



CREATE TABLE IF NOT EXISTS "public"."workspace_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'staff'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "restaurant_access_mode" "text" DEFAULT 'all'::"text" NOT NULL,
    CONSTRAINT "workspace_members_restaurant_access_mode_check" CHECK (("restaurant_access_mode" = ANY (ARRAY['all'::"text", 'selected'::"text"]))),
    CONSTRAINT "workspace_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'staff'::"text", 'readonly'::"text"])))
);


ALTER TABLE "public"."workspace_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_members" IS 'User membership and workspace-level role. readonly remains as a legacy compatibility role.';



COMMENT ON COLUMN "public"."workspace_members"."restaurant_access_mode" IS 'all grants workspace restaurant access; selected uses workspace_member_restaurants.';



CREATE TABLE IF NOT EXISTS "public"."workspace_push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "platform" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspace_push_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."workspace_push_subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_push_subscriptions" IS 'Authenticated user/device Web Push subscriptions scoped to a workspace.';



COMMENT ON COLUMN "public"."workspace_push_subscriptions"."endpoint" IS 'Web Push endpoint; treated as sensitive capability data and never shown in UI.';



CREATE TABLE IF NOT EXISTS "public"."workspace_pwa_settings" (
    "workspace_id" "uuid" NOT NULL,
    "app_name" "text",
    "icon_url" "text",
    "theme_color" "text" DEFAULT '#1e40af'::"text" NOT NULL,
    "background_color" "text" DEFAULT '#ffffff'::"text" NOT NULL,
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspace_pwa_settings_app_name_check" CHECK ((("app_name" IS NULL) OR (("length"("btrim"("app_name")) >= 1) AND ("length"("btrim"("app_name")) <= 60)))),
    CONSTRAINT "workspace_pwa_settings_background_color_check" CHECK (("background_color" ~ '^#[0-9a-fA-F]{6}$'::"text")),
    CONSTRAINT "workspace_pwa_settings_theme_color_check" CHECK (("theme_color" ~ '^#[0-9a-fA-F]{6}$'::"text"))
);


ALTER TABLE "public"."workspace_pwa_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_pwa_settings" IS 'Workspace-level management PWA branding. Public-safe fields only.';



CREATE TABLE IF NOT EXISTS "public"."workspace_subscriptions" (
    "workspace_id" "uuid" NOT NULL,
    "plan_key" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "source" "text" DEFAULT 'system'::"text" NOT NULL,
    "current_period_start" "date",
    "current_period_end" "date",
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider" "text",
    "provider_environment" "text",
    "provider_customer_id" "text",
    "provider_subscription_id" "text",
    "provider_price_id" "text",
    "provider_status" "text",
    "billing_interval" "text",
    "billing_currency" "text",
    "current_period_start_at" timestamp with time zone,
    "current_period_end_at" timestamp with time zone,
    "last_provider_event_at" timestamp with time zone,
    "last_provider_event_id" "text",
    "next_billed_at" timestamp with time zone,
    "scheduled_change_at" timestamp with time zone,
    "scheduled_change_action" "text",
    "billing_issue_code" "text",
    "payment_failure_started_at" timestamp with time zone,
    "payment_grace_ends_at" timestamp with time zone,
    "scheduled_plan_key" "text",
    "scheduled_plan_at" "date",
    "scheduled_effective_at" timestamp with time zone,
    "scheduled_plan_interval" "text",
    "scheduled_provider_price_id" "text",
    CONSTRAINT "workspace_subscriptions_period_check" CHECK (((("current_period_start" IS NULL) AND ("current_period_end" IS NULL)) OR (("current_period_start" IS NOT NULL) AND ("current_period_end" IS NOT NULL) AND ("current_period_end" > "current_period_start")))),
    CONSTRAINT "workspace_subscriptions_provider_check" CHECK ((("provider" IS NULL) OR ("provider" = 'paddle'::"text"))),
    CONSTRAINT "workspace_subscriptions_provider_environment_check" CHECK ((("provider_environment" IS NULL) OR ("provider_environment" = ANY (ARRAY['sandbox'::"text", 'live'::"text"])))),
    CONSTRAINT "workspace_subscriptions_payment_grace_check" CHECK ((("payment_failure_started_at" IS NULL) AND ("payment_grace_ends_at" IS NULL)) OR (("payment_failure_started_at" IS NOT NULL) AND ("payment_grace_ends_at" IS NOT NULL) AND ("payment_grace_ends_at" >= "payment_failure_started_at"))),
    CONSTRAINT "workspace_subscriptions_scheduled_change_action_check" CHECK ((("scheduled_change_action" IS NULL) OR ("scheduled_change_action" = ANY (ARRAY['cancel'::"text", 'pause'::"text", 'resume'::"text"])))),
    CONSTRAINT "workspace_subscriptions_scheduled_plan_check" CHECK (((("scheduled_plan_key" IS NULL) AND ("scheduled_plan_at" IS NULL)) OR (("scheduled_plan_key" IS NOT NULL) AND ("scheduled_plan_at" IS NOT NULL)))),
    CONSTRAINT "workspace_subscriptions_source_check" CHECK (("source" = ANY (ARRAY['free'::"text", 'manual'::"text", 'system'::"text", 'paddle'::"text"]))),
    CONSTRAINT "workspace_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'past_due'::"text", 'canceled'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."workspace_subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_subscriptions" IS 'Current workspace commercial state. Paddle will synchronize this table in a later phase.';



COMMENT ON COLUMN "public"."workspace_subscriptions"."plan_key" IS 'Reservevia entitlement plan. Paddle price identity is resolved through billing_provider_prices.';



COMMENT ON COLUMN "public"."workspace_subscriptions"."last_provider_event_at" IS 'Latest Paddle event timestamp applied; older events cannot overwrite local state.';



COMMENT ON COLUMN "public"."workspace_subscriptions"."scheduled_plan_key" IS 'Plan that becomes the local entitlement plan at scheduled_plan_at.';



COMMENT ON COLUMN "public"."workspace_subscriptions"."scheduled_plan_at" IS 'Date on which the scheduled entitlement plan becomes effective.';



CREATE TABLE IF NOT EXISTS "public"."workspace_usage_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "reservations_created" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspace_usage_period_range_check" CHECK (("period_end" > "period_start")),
    CONSTRAINT "workspace_usage_periods_reservations_created_check" CHECK (("reservations_created" >= 0))
);


ALTER TABLE "public"."workspace_usage_periods" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_usage_periods" IS 'Immutable-period usage counters. Reservation creation increments these atomically.';



COMMENT ON COLUMN "public"."workspace_usage_periods"."reservations_created" IS 'Successful reservation inserts only; cancellation and deletion never decrement this value.';



CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "onboarding_completed_at" timestamp with time zone,
    "platform_status" "text" DEFAULT 'active'::"text" NOT NULL,
    CONSTRAINT "workspaces_name_not_blank" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "workspaces_platform_status_check" CHECK (("platform_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'archived'::"text"]))),
    CONSTRAINT "workspaces_slug_format" CHECK (("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::"text")),
    CONSTRAINT "workspaces_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspaces" IS 'Reservevia customer/account boundary. Subscription ownership will belong here in a later phase.';



COMMENT ON COLUMN "public"."workspaces"."onboarding_completed_at" IS 'Set when the first self-service restaurant is published. Progress is derived from persisted tenant data.';



COMMENT ON COLUMN "public"."workspaces"."platform_status" IS 'Platform moderation state; workspace.status remains the customer lifecycle state.';



ALTER TABLE ONLY "public"."admin_profiles"
    ADD CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_push_subscriptions"
    ADD CONSTRAINT "admin_push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."admin_push_subscriptions"
    ADD CONSTRAINT "admin_push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_checkout_sessions"
    ADD CONSTRAINT "billing_checkout_sessions_idempotency_key" UNIQUE ("provider", "environment", "idempotency_key");



ALTER TABLE ONLY "public"."billing_checkout_sessions"
    ADD CONSTRAINT "billing_checkout_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_checkout_sessions"
    ADD CONSTRAINT "billing_checkout_sessions_transaction_key" UNIQUE ("provider", "environment", "provider_transaction_id");



ALTER TABLE ONLY "public"."billing_provider_prices"
    ADD CONSTRAINT "billing_provider_prices_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."billing_mutations"
    ADD CONSTRAINT "billing_mutations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."billing_cancellation_feedback"
    ADD CONSTRAINT "billing_cancellation_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_provider_prices"
    ADD CONSTRAINT "billing_provider_prices_provider_price_key" UNIQUE ("provider", "environment", "provider_price_id");



ALTER TABLE ONLY "public"."billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_provider_event_key" UNIQUE ("provider", "provider_event_id");



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_restaurant_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."platform_audit_logs"
    ADD CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_members"
    ADD CONSTRAINT "platform_members_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."platform_restaurant_import_rows"
    ADD CONSTRAINT "platform_restaurant_import_rows_batch_row_key" UNIQUE ("import_id", "excel_row_number");



ALTER TABLE ONLY "public"."platform_restaurant_import_rows"
    ADD CONSTRAINT "platform_restaurant_import_rows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_restaurant_imports"
    ADD CONSTRAINT "platform_restaurant_imports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."platform_user_controls"
    ADD CONSTRAINT "platform_user_controls_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."platform_user_directory"
    ADD CONSTRAINT "platform_user_directory_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."public_reservation_rate_limits"
    ADD CONSTRAINT "public_reservation_rate_limits_pkey" PRIMARY KEY ("key_hash");



ALTER TABLE ONLY "public"."reservation_areas"
    ADD CONSTRAINT "reservation_areas_name_key" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."reservation_areas"
    ADD CONSTRAINT "reservation_areas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reservation_management_tokens"
    ADD CONSTRAINT "reservation_management_tokens_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."reservation_management_tokens"
    ADD CONSTRAINT "reservation_management_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_claim_profiles"
    ADD CONSTRAINT "restaurant_claim_profiles_pkey" PRIMARY KEY ("restaurant_id");



ALTER TABLE ONLY "public"."restaurant_claims"
    ADD CONSTRAINT "restaurant_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_domains"
    ADD CONSTRAINT "restaurant_domains_one_per_restaurant" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."restaurant_domains"
    ADD CONSTRAINT "restaurant_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_media"
    ADD CONSTRAINT "restaurant_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_overrides"
    ADD CONSTRAINT "subscription_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_invitation_restaurants"
    ADD CONSTRAINT "workspace_invitation_restaurants_pkey" PRIMARY KEY ("invitation_id", "restaurant_id");



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."workspace_member_restaurants"
    ADD CONSTRAINT "workspace_member_restaurants_pkey" PRIMARY KEY ("member_id", "restaurant_id");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_user_key" UNIQUE ("workspace_id", "user_id");



ALTER TABLE ONLY "public"."workspace_push_subscriptions"
    ADD CONSTRAINT "workspace_push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_push_subscriptions"
    ADD CONSTRAINT "workspace_push_subscriptions_workspace_id_user_id_endpoint_key" UNIQUE ("workspace_id", "user_id", "endpoint");



ALTER TABLE ONLY "public"."workspace_pwa_settings"
    ADD CONSTRAINT "workspace_pwa_settings_pkey" PRIMARY KEY ("workspace_id");



ALTER TABLE ONLY "public"."workspace_subscriptions"
    ADD CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY ("workspace_id");



ALTER TABLE ONLY "public"."workspace_usage_periods"
    ADD CONSTRAINT "workspace_usage_period_unique" UNIQUE ("workspace_id", "period_start", "period_end");



ALTER TABLE ONLY "public"."workspace_usage_periods"
    ADD CONSTRAINT "workspace_usage_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



CREATE INDEX "billing_checkout_sessions_target_plan_idx" ON "public"."billing_checkout_sessions" USING "btree" ("target_plan_key");



CREATE INDEX "billing_checkout_sessions_workspace_idx" ON "public"."billing_checkout_sessions" USING "btree" ("workspace_id", "created_at" DESC);



CREATE UNIQUE INDEX "billing_provider_prices_active_plan_key" ON "public"."billing_provider_prices" USING "btree" ("provider", "environment", "plan_key", "billing_interval", "currency") WHERE ("active" = true);



CREATE INDEX "billing_provider_prices_lookup_idx" ON "public"."billing_provider_prices" USING "btree" ("provider", "environment", "plan_key", "active");



CREATE INDEX "billing_webhook_events_processing_idx" ON "public"."billing_webhook_events" USING "btree" ("provider", "status", "received_at");



CREATE INDEX "billing_webhook_events_workspace_idx" ON "public"."billing_webhook_events" USING "btree" ("workspace_id", "occurred_at" DESC);



CREATE INDEX "idx_admin_profiles_restaurant_id" ON "public"."admin_profiles" USING "btree" ("restaurant_id");



CREATE INDEX "idx_admin_push_subscriptions_restaurant_id" ON "public"."admin_push_subscriptions" USING "btree" ("restaurant_id");



CREATE INDEX "idx_admin_push_subscriptions_user_id" ON "public"."admin_push_subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_reservation_areas_active" ON "public"."reservation_areas" USING "btree" ("restaurant_id", "is_active");



CREATE INDEX "idx_reservation_areas_restaurant_id" ON "public"."reservation_areas" USING "btree" ("restaurant_id");



CREATE INDEX "idx_reservations_area_id" ON "public"."reservations" USING "btree" ("reservation_area_id");



CREATE INDEX "idx_reservations_booked_by_user_id" ON "public"."reservations" USING "btree" ("booked_by_user_id");



CREATE INDEX "idx_reservations_created_at" ON "public"."reservations" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reservations_restaurant_created" ON "public"."reservations" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "idx_reservations_restaurant_date" ON "public"."reservations" USING "btree" ("restaurant_id", "reservation_date");



CREATE INDEX "idx_reservations_restaurant_date_status_time" ON "public"."reservations" USING "btree" ("restaurant_id", "reservation_date", "status", "reservation_time", "created_at");



CREATE INDEX "idx_reservations_restaurant_status_date" ON "public"."reservations" USING "btree" ("restaurant_id", "status", "reservation_date");



CREATE INDEX "idx_restaurant_media_restaurant_order" ON "public"."restaurant_media" USING "btree" ("restaurant_id", "media_order");



CREATE INDEX "plans_active_sort_idx" ON "public"."plans" USING "btree" ("active", "sort_order");



CREATE INDEX "platform_audit_logs_actor_idx" ON "public"."platform_audit_logs" USING "btree" ("actor_user_id", "created_at" DESC);



CREATE INDEX "platform_audit_logs_created_idx" ON "public"."platform_audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "platform_audit_logs_entity_idx" ON "public"."platform_audit_logs" USING "btree" ("entity_type", "entity_id", "created_at" DESC);



CREATE INDEX "platform_members_created_by_idx" ON "public"."platform_members" USING "btree" ("created_by");



CREATE INDEX "platform_members_role_status_idx" ON "public"."platform_members" USING "btree" ("role", "status");



CREATE INDEX "platform_restaurant_import_rows_status_idx" ON "public"."platform_restaurant_import_rows" USING "btree" ("import_id", "row_status", "validation_status");



CREATE INDEX "platform_restaurant_imports_actor_status_idx" ON "public"."platform_restaurant_imports" USING "btree" ("actor_user_id", "status", "created_at" DESC);



CREATE INDEX "platform_settings_updated_by_idx" ON "public"."platform_settings" USING "btree" ("updated_by");



CREATE INDEX "platform_user_controls_status_idx" ON "public"."platform_user_controls" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "platform_user_controls_suspended_by_idx" ON "public"."platform_user_controls" USING "btree" ("suspended_by");



CREATE INDEX "platform_user_directory_activity_idx" ON "public"."platform_user_directory" USING "btree" ("last_sign_in_at" DESC, "created_at" DESC);



CREATE INDEX "platform_user_directory_email_idx" ON "public"."platform_user_directory" USING "btree" ("lower"("email"));



CREATE INDEX "platform_user_directory_name_idx" ON "public"."platform_user_directory" USING "btree" ("lower"("full_name"));



CREATE INDEX "public_reservation_rate_limits_updated_idx" ON "public"."public_reservation_rate_limits" USING "btree" ("updated_at");



CREATE INDEX "reservation_management_tokens_reservation_idx" ON "public"."reservation_management_tokens" USING "btree" ("reservation_id", "expires_at" DESC);



CREATE INDEX "reservations_last_updated_by_user_idx" ON "public"."reservations" USING "btree" ("last_updated_by_user_id");



CREATE UNIQUE INDEX "reservations_public_submission_key" ON "public"."reservations" USING "btree" ("restaurant_id", "public_submission_id") WHERE ("public_submission_id" IS NOT NULL);



CREATE INDEX "restaurant_claim_profiles_domain_idx" ON "public"."restaurant_claim_profiles" USING "btree" ("official_domain") WHERE ("official_domain" IS NOT NULL);



CREATE INDEX "restaurant_claim_profiles_email_idx" ON "public"."restaurant_claim_profiles" USING "btree" ("normalized_business_contact_email") WHERE ("normalized_business_contact_email" IS NOT NULL);



CREATE INDEX "restaurant_claim_profiles_ownership_idx" ON "public"."restaurant_claim_profiles" USING "btree" ("ownership_status", "updated_at" DESC);



CREATE INDEX "restaurant_claims_restaurant_status_idx" ON "public"."restaurant_claims" USING "btree" ("restaurant_id", "status", "created_at" DESC);



CREATE INDEX "restaurant_claims_token_hash_idx" ON "public"."restaurant_claims" USING "btree" ("token_hash") WHERE ("token_hash" IS NOT NULL);



CREATE INDEX "restaurant_domains_created_by_idx" ON "public"."restaurant_domains" USING "btree" ("created_by");



CREATE UNIQUE INDEX "restaurant_domains_hostname_key" ON "public"."restaurant_domains" USING "btree" ("lower"("hostname"));



CREATE INDEX "restaurant_domains_provider_environment_idx" ON "public"."restaurant_domains" USING "btree" ("provider", "provider_environment");



CREATE INDEX "restaurant_domains_status_idx" ON "public"."restaurant_domains" USING "btree" ("status");



CREATE INDEX "restaurants_platform_status_idx" ON "public"."restaurants" USING "btree" ("platform_status", "updated_at" DESC);



CREATE UNIQUE INDEX "restaurants_slug_key" ON "public"."restaurants" USING "btree" ("slug");



CREATE INDEX "restaurants_workspace_id_idx" ON "public"."restaurants" USING "btree" ("workspace_id");



CREATE INDEX "subscription_overrides_active_idx" ON "public"."subscription_overrides" USING "btree" ("workspace_id", "effective_from" DESC) WHERE ("revoked_at" IS NULL);



CREATE INDEX "subscription_overrides_created_by_idx" ON "public"."subscription_overrides" USING "btree" ("created_by");



CREATE INDEX "subscription_overrides_plan_key_idx" ON "public"."subscription_overrides" USING "btree" ("plan_key");



CREATE INDEX "subscription_overrides_revoked_by_idx" ON "public"."subscription_overrides" USING "btree" ("revoked_by");



CREATE INDEX "subscription_overrides_workspace_effective_idx" ON "public"."subscription_overrides" USING "btree" ("workspace_id", "effective_from" DESC, "effective_until");



CREATE INDEX "workspace_invitation_restaurants_restaurant_idx" ON "public"."workspace_invitation_restaurants" USING "btree" ("restaurant_id", "invitation_id");



CREATE UNIQUE INDEX "workspace_invitations_active_email_key" ON "public"."workspace_invitations" USING "btree" ("workspace_id", "normalized_email") WHERE (("accepted_at" IS NULL) AND ("revoked_at" IS NULL));



CREATE INDEX "workspace_invitations_invited_by_idx" ON "public"."workspace_invitations" USING "btree" ("invited_by");



CREATE INDEX "workspace_invitations_workspace_status_idx" ON "public"."workspace_invitations" USING "btree" ("workspace_id", "expires_at") WHERE (("accepted_at" IS NULL) AND ("revoked_at" IS NULL));



CREATE INDEX "workspace_member_restaurants_restaurant_idx" ON "public"."workspace_member_restaurants" USING "btree" ("restaurant_id", "member_id");



CREATE INDEX "workspace_members_user_id_idx" ON "public"."workspace_members" USING "btree" ("user_id");



CREATE INDEX "workspace_members_user_workspace_idx" ON "public"."workspace_members" USING "btree" ("user_id", "workspace_id");



CREATE INDEX "workspace_members_workspace_id_idx" ON "public"."workspace_members" USING "btree" ("workspace_id");



CREATE INDEX "workspace_push_subscriptions_user_status_idx" ON "public"."workspace_push_subscriptions" USING "btree" ("user_id", "status");



CREATE INDEX "workspace_push_subscriptions_workspace_status_idx" ON "public"."workspace_push_subscriptions" USING "btree" ("workspace_id", "status", "user_id");



CREATE INDEX "workspace_pwa_settings_updated_by_idx" ON "public"."workspace_pwa_settings" USING "btree" ("updated_by");



CREATE INDEX "workspace_subscriptions_plan_idx" ON "public"."workspace_subscriptions" USING "btree" ("plan_key");



CREATE INDEX "workspace_subscriptions_provider_customer_idx" ON "public"."workspace_subscriptions" USING "btree" ("provider", "provider_environment", "provider_customer_id") WHERE ("provider_customer_id" IS NOT NULL);



CREATE UNIQUE INDEX "workspace_subscriptions_provider_subscription_key" ON "public"."workspace_subscriptions" USING "btree" ("provider", "provider_environment", "provider_subscription_id") WHERE ("provider_subscription_id" IS NOT NULL);



CREATE INDEX "workspace_subscriptions_scheduled_plan_idx" ON "public"."workspace_subscriptions" USING "btree" ("scheduled_plan_key", "scheduled_plan_at") WHERE ("scheduled_plan_key" IS NOT NULL);

CREATE INDEX "workspace_subscriptions_scheduled_effective_idx" ON "public"."workspace_subscriptions" USING "btree" ("scheduled_effective_at") WHERE ("scheduled_effective_at" IS NOT NULL);

CREATE INDEX "workspace_subscriptions_payment_grace_idx" ON "public"."workspace_subscriptions" USING "btree" ("payment_grace_ends_at") WHERE (("payment_grace_ends_at" IS NOT NULL) AND ("plan_key" <> 'free'::"text"));

CREATE UNIQUE INDEX "billing_mutations_request_key_idx" ON "public"."billing_mutations" USING "btree" ("workspace_id", "request_key");

CREATE UNIQUE INDEX "billing_mutations_one_pending_workspace" ON "public"."billing_mutations" USING "btree" ("workspace_id") WHERE ("status" = ANY (ARRAY['pending'::text, 'unknown'::text]));

CREATE INDEX "billing_mutations_workspace_created_idx" ON "public"."billing_mutations" USING "btree" ("workspace_id", "created_at" DESC);

CREATE INDEX "billing_cancellation_feedback_workspace_idx" ON "public"."billing_cancellation_feedback" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "workspace_usage_periods_workspace_period_idx" ON "public"."workspace_usage_periods" USING "btree" ("workspace_id", "period_start" DESC, "period_end" DESC);



CREATE INDEX "workspaces_created_by_idx" ON "public"."workspaces" USING "btree" ("created_by");



CREATE INDEX "workspaces_platform_status_idx" ON "public"."workspaces" USING "btree" ("platform_status", "updated_at" DESC);



CREATE UNIQUE INDEX "workspaces_self_service_creator_key" ON "public"."workspaces" USING "btree" ("created_by") WHERE ("created_by" IS NOT NULL);



CREATE UNIQUE INDEX "workspaces_slug_key" ON "public"."workspaces" USING "btree" ("slug");



CREATE OR REPLACE TRIGGER "admin_profiles_set_updated_at" BEFORE UPDATE ON "public"."admin_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "admin_push_subscriptions_set_updated_at" BEFORE UPDATE ON "public"."admin_push_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "billing_checkout_sessions_set_updated_at" BEFORE UPDATE ON "public"."billing_checkout_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "billing_provider_prices_set_updated_at" BEFORE UPDATE ON "public"."billing_provider_prices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

CREATE OR REPLACE TRIGGER "billing_mutations_set_updated_at" BEFORE UPDATE ON "public"."billing_mutations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "notification_settings_set_updated_at" BEFORE UPDATE ON "public"."notification_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "plans_set_updated_at" BEFORE UPDATE ON "public"."plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "platform_members_set_updated_at" BEFORE UPDATE ON "public"."platform_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "platform_restaurant_import_rows_set_updated_at" BEFORE UPDATE ON "public"."platform_restaurant_import_rows" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "platform_restaurant_imports_set_updated_at" BEFORE UPDATE ON "public"."platform_restaurant_imports" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "platform_settings_set_updated_at" BEFORE UPDATE ON "public"."platform_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "platform_user_controls_set_updated_at" BEFORE UPDATE ON "public"."platform_user_controls" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reservation_areas_set_updated_at" BEFORE UPDATE ON "public"."reservation_areas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reservations_consume_workspace_quota" BEFORE INSERT ON "public"."reservations" FOR EACH ROW EXECUTE FUNCTION "private"."consume_reservation_quota"();



CREATE OR REPLACE TRIGGER "reservations_set_updated_at" BEFORE UPDATE ON "public"."reservations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reservations_validate_type" BEFORE INSERT OR UPDATE ON "public"."reservations" FOR EACH ROW EXECUTE FUNCTION "public"."validate_reservation_type"();



CREATE OR REPLACE TRIGGER "restaurant_claim_profiles_set_updated_at" BEFORE UPDATE ON "public"."restaurant_claim_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "restaurant_claims_set_updated_at" BEFORE UPDATE ON "public"."restaurant_claims" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "restaurant_domains_set_updated_at" BEFORE UPDATE ON "public"."restaurant_domains" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "restaurants_acquisition_dependencies" AFTER INSERT ON "public"."restaurants" FOR EACH ROW EXECUTE FUNCTION "private"."ensure_restaurant_acquisition_dependencies"();



CREATE OR REPLACE TRIGGER "restaurants_enforce_workspace_limit" BEFORE INSERT OR UPDATE OF "workspace_id" ON "public"."restaurants" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_workspace_restaurant_limit"();



CREATE OR REPLACE TRIGGER "restaurants_set_updated_at" BEFORE UPDATE ON "public"."restaurants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "subscription_overrides_set_updated_at" BEFORE UPDATE ON "public"."subscription_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_invitations_set_updated_at" BEFORE UPDATE ON "public"."workspace_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_members_enforce_user_limit" BEFORE INSERT ON "public"."workspace_members" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_workspace_member_limit"();



CREATE OR REPLACE TRIGGER "workspace_members_set_updated_at" BEFORE UPDATE ON "public"."workspace_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_push_subscriptions_set_updated_at" BEFORE UPDATE ON "public"."workspace_push_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_pwa_settings_set_updated_at" BEFORE UPDATE ON "public"."workspace_pwa_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_subscriptions_set_updated_at" BEFORE UPDATE ON "public"."workspace_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspace_usage_periods_set_updated_at" BEFORE UPDATE ON "public"."workspace_usage_periods" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspaces_assign_default_subscription" AFTER INSERT ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "private"."assign_default_workspace_subscription"();



CREATE OR REPLACE TRIGGER "workspaces_set_updated_at" BEFORE UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."admin_profiles"
    ADD CONSTRAINT "admin_profiles_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_push_subscriptions"
    ADD CONSTRAINT "admin_push_subscriptions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_push_subscriptions"
    ADD CONSTRAINT "admin_push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."admin_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_checkout_sessions"
    ADD CONSTRAINT "billing_checkout_sessions_target_plan_key_fkey" FOREIGN KEY ("target_plan_key") REFERENCES "public"."plans"("key");



ALTER TABLE ONLY "public"."billing_checkout_sessions"
    ADD CONSTRAINT "billing_checkout_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_provider_prices"
    ADD CONSTRAINT "billing_provider_prices_plan_key_fkey" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key");

ALTER TABLE ONLY "public"."billing_mutations"
    ADD CONSTRAINT "billing_mutations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."billing_cancellation_feedback"
    ADD CONSTRAINT "billing_cancellation_feedback_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_audit_logs"
    ADD CONSTRAINT "platform_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_members"
    ADD CONSTRAINT "platform_members_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_members"
    ADD CONSTRAINT "platform_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_restaurant_import_rows"
    ADD CONSTRAINT "platform_restaurant_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."platform_restaurant_imports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_restaurant_import_rows"
    ADD CONSTRAINT "platform_restaurant_import_rows_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_restaurant_imports"
    ADD CONSTRAINT "platform_restaurant_imports_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_user_controls"
    ADD CONSTRAINT "platform_user_controls_suspended_by_fkey" FOREIGN KEY ("suspended_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_user_controls"
    ADD CONSTRAINT "platform_user_controls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_user_directory"
    ADD CONSTRAINT "platform_user_directory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservation_areas"
    ADD CONSTRAINT "reservation_areas_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservation_management_tokens"
    ADD CONSTRAINT "reservation_management_tokens_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservation_management_tokens"
    ADD CONSTRAINT "reservation_management_tokens_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_booked_by_user_id_fkey" FOREIGN KEY ("booked_by_user_id") REFERENCES "public"."admin_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_last_updated_by_user_id_fkey" FOREIGN KEY ("last_updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_reservation_area_id_fkey" FOREIGN KEY ("reservation_area_id") REFERENCES "public"."reservation_areas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_claim_profiles"
    ADD CONSTRAINT "restaurant_claim_profiles_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_claim_profiles"
    ADD CONSTRAINT "restaurant_claim_profiles_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_claim_profiles"
    ADD CONSTRAINT "restaurant_claim_profiles_source_import_id_fkey" FOREIGN KEY ("source_import_id") REFERENCES "public"."platform_restaurant_imports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_claims"
    ADD CONSTRAINT "restaurant_claims_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_claims"
    ADD CONSTRAINT "restaurant_claims_claimant_user_id_fkey" FOREIGN KEY ("claimant_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_claims"
    ADD CONSTRAINT "restaurant_claims_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_claims"
    ADD CONSTRAINT "restaurant_claims_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_claims"
    ADD CONSTRAINT "restaurant_claims_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_domains"
    ADD CONSTRAINT "restaurant_domains_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_domains"
    ADD CONSTRAINT "restaurant_domains_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_media"
    ADD CONSTRAINT "restaurant_media_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."subscription_overrides"
    ADD CONSTRAINT "subscription_overrides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscription_overrides"
    ADD CONSTRAINT "subscription_overrides_plan_key_fkey" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key");



ALTER TABLE ONLY "public"."subscription_overrides"
    ADD CONSTRAINT "subscription_overrides_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscription_overrides"
    ADD CONSTRAINT "subscription_overrides_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_invitation_restaurants"
    ADD CONSTRAINT "workspace_invitation_restaurants_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "public"."workspace_invitations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_invitation_restaurants"
    ADD CONSTRAINT "workspace_invitation_restaurants_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_member_restaurants"
    ADD CONSTRAINT "workspace_member_restaurants_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_member_restaurants"
    ADD CONSTRAINT "workspace_member_restaurants_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_push_subscriptions"
    ADD CONSTRAINT "workspace_push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_push_subscriptions"
    ADD CONSTRAINT "workspace_push_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_pwa_settings"
    ADD CONSTRAINT "workspace_pwa_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workspace_pwa_settings"
    ADD CONSTRAINT "workspace_pwa_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_subscriptions"
    ADD CONSTRAINT "workspace_subscriptions_plan_key_fkey" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key");



ALTER TABLE ONLY "public"."workspace_subscriptions"
    ADD CONSTRAINT "workspace_subscriptions_scheduled_plan_key_fkey" FOREIGN KEY ("scheduled_plan_key") REFERENCES "public"."plans"("key");



ALTER TABLE ONLY "public"."workspace_subscriptions"
    ADD CONSTRAINT "workspace_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_usage_periods"
    ADD CONSTRAINT "workspace_usage_periods_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



CREATE POLICY "Active plans are publicly readable" ON "public"."plans" FOR SELECT TO "authenticated", "anon" USING (("active" = true));



CREATE POLICY "Members can create own workspace push subscriptions" ON "public"."workspace_push_subscriptions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."is_workspace_member"("workspace_id") AND "private"."workspace_feature_enabled"("workspace_id", 'pushNotifications'::"text")));



CREATE POLICY "Members can delete own workspace push subscriptions" ON "public"."workspace_push_subscriptions" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."is_workspace_member"("workspace_id") AND "private"."workspace_feature_enabled"("workspace_id", 'pushNotifications'::"text")));



CREATE POLICY "Members can read own workspace push subscriptions" ON "public"."workspace_push_subscriptions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."is_workspace_member"("workspace_id")));



CREATE POLICY "Members can read their restaurant assignments" ON "public"."workspace_member_restaurants" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workspace_members" "member"
  WHERE (("member"."id" = "workspace_member_restaurants"."member_id") AND (("member"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_workspace_role"("member"."workspace_id", ARRAY['owner'::"text", 'admin'::"text"]))))));



CREATE POLICY "Members can read workspace memberships" ON "public"."workspace_members" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"])));



CREATE POLICY "Members can read workspace subscription" ON "public"."workspace_subscriptions" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_workspace_member"("workspace_subscriptions"."workspace_id") AS "is_workspace_member"));



CREATE POLICY "Members can read workspace usage" ON "public"."workspace_usage_periods" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_workspace_member"("workspace_usage_periods"."workspace_id") AS "is_workspace_member"));



CREATE POLICY "Members can update own workspace push subscriptions" ON "public"."workspace_push_subscriptions" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."is_workspace_member"("workspace_id") AND "private"."workspace_feature_enabled"("workspace_id", 'pushNotifications'::"text"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."is_workspace_member"("workspace_id") AND "private"."workspace_feature_enabled"("workspace_id", 'pushNotifications'::"text")));



CREATE POLICY "Owners and admins can create PWA settings" ON "public"."workspace_pwa_settings" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]) AND "private"."workspace_feature_enabled"("workspace_id", 'customPWA'::"text")));



CREATE POLICY "Owners and admins can delete PWA settings" ON "public"."workspace_pwa_settings" FOR DELETE TO "authenticated" USING (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]) AND "private"."workspace_feature_enabled"("workspace_id", 'customPWA'::"text")));



CREATE POLICY "Owners and admins can read invitation assignments" ON "public"."workspace_invitation_restaurants" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workspace_invitations" "invitation"
  WHERE (("invitation"."id" = "workspace_invitation_restaurants"."invitation_id") AND "public"."has_workspace_role"("invitation"."workspace_id", ARRAY['owner'::"text", 'admin'::"text"])))));



CREATE POLICY "Owners and admins can read workspace invitations" ON "public"."workspace_invitations" FOR SELECT TO "authenticated" USING ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "Owners and admins can update PWA settings" ON "public"."workspace_pwa_settings" FOR UPDATE TO "authenticated" USING (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]) AND "private"."workspace_feature_enabled"("workspace_id", 'customPWA'::"text"))) WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]) AND "private"."workspace_feature_enabled"("workspace_id", 'customPWA'::"text")));



CREATE POLICY "Read own push subscriptions" ON "public"."admin_push_subscriptions" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can create own push subscriptions" ON "public"."admin_push_subscriptions" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (("restaurant_id" IS NULL) OR "public"."can_access_restaurant"("restaurant_id"))));



CREATE POLICY "Users can delete own push subscriptions" ON "public"."admin_push_subscriptions" FOR DELETE USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (("restaurant_id" IS NULL) OR "public"."can_access_restaurant"("restaurant_id"))));



CREATE POLICY "Users can read compatible profiles" ON "public"."admin_profiles" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "id") OR (EXISTS ( SELECT 1
   FROM "public"."workspace_members" "membership"
  WHERE (("membership"."user_id" = "admin_profiles"."id") AND "public"."has_workspace_role"("membership"."workspace_id", ARRAY['owner'::"text", 'admin'::"text"]))))));



CREATE POLICY "Users can update own push subscriptions" ON "public"."admin_push_subscriptions" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (("restaurant_id" IS NULL) OR "public"."can_access_restaurant"("restaurant_id")))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (("restaurant_id" IS NULL) OR "public"."can_access_restaurant"("restaurant_id"))));



CREATE POLICY "Workspace managers can create notification settings" ON "public"."notification_settings" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "notification_settings"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])));



CREATE POLICY "Workspace managers can create reservation areas" ON "public"."reservation_areas" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "reservation_areas"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])));



CREATE POLICY "Workspace managers can create restaurant media" ON "public"."restaurant_media" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "restaurant_media"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "Workspace managers can create restaurants" ON "public"."restaurants" FOR INSERT WITH CHECK ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "Workspace managers can delete notification settings" ON "public"."notification_settings" FOR DELETE TO "authenticated" USING (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "notification_settings"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])));



CREATE POLICY "Workspace managers can delete reservation areas" ON "public"."reservation_areas" FOR DELETE TO "authenticated" USING (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "reservation_areas"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])));



CREATE POLICY "Workspace managers can delete reservations" ON "public"."reservations" FOR DELETE TO "authenticated" USING (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "reservations"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])));



CREATE POLICY "Workspace managers can delete restaurant media" ON "public"."restaurant_media" FOR DELETE TO "authenticated" USING ("public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "restaurant_media"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "Workspace managers can update notification settings" ON "public"."notification_settings" FOR UPDATE TO "authenticated" USING (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "notification_settings"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"]))) WITH CHECK (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "notification_settings"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])));



CREATE POLICY "Workspace managers can update reservation areas" ON "public"."reservation_areas" FOR UPDATE TO "authenticated" USING (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "reservation_areas"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"]))) WITH CHECK (("public"."can_access_restaurant"("restaurant_id") AND "public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "reservation_areas"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])));



CREATE POLICY "Workspace managers can update restaurant media" ON "public"."restaurant_media" FOR UPDATE TO "authenticated" USING ("public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "restaurant_media"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text"])) WITH CHECK ("public"."has_workspace_role"(( SELECT "restaurants"."workspace_id"
   FROM "public"."restaurants"
  WHERE ("restaurants"."id" = "restaurant_media"."restaurant_id")), ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "Workspace managers can update restaurants" ON "public"."restaurants" FOR UPDATE TO "authenticated" USING (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]) OR ("public"."has_workspace_role"("workspace_id", ARRAY['manager'::"text"]) AND "public"."can_access_restaurant"("id")))) WITH CHECK (("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text", 'admin'::"text"]) OR ("public"."has_workspace_role"("workspace_id", ARRAY['manager'::"text"]) AND "public"."can_access_restaurant"("id"))));



CREATE POLICY "Workspace members can read PWA settings" ON "public"."workspace_pwa_settings" FOR SELECT TO "authenticated" USING ("public"."is_workspace_member"("workspace_id"));



CREATE POLICY "Workspace members can read domains" ON "public"."restaurant_domains" FOR SELECT TO "authenticated" USING ("public"."can_access_restaurant"("restaurant_id"));



CREATE POLICY "Workspace members can read notification settings" ON "public"."notification_settings" FOR SELECT TO "authenticated" USING ("public"."can_access_restaurant"("restaurant_id"));



CREATE POLICY "Workspace members can read reservation areas" ON "public"."reservation_areas" FOR SELECT TO "authenticated" USING ("public"."can_access_restaurant"("restaurant_id"));



CREATE POLICY "Workspace members can read reservations" ON "public"."reservations" FOR SELECT USING ("public"."can_access_restaurant"("restaurant_id"));



CREATE POLICY "Workspace members can read restaurant media" ON "public"."restaurant_media" FOR SELECT TO "authenticated" USING ("public"."can_access_restaurant"("restaurant_id"));



CREATE POLICY "Workspace members can read restaurants" ON "public"."restaurants" FOR SELECT USING ("public"."can_access_restaurant"("id"));



CREATE POLICY "Workspace members can read workspaces" ON "public"."workspaces" FOR SELECT USING ("public"."is_workspace_member"("id"));



CREATE POLICY "Workspace owners can delete restaurants" ON "public"."restaurants" FOR DELETE USING ("public"."has_workspace_role"("workspace_id", ARRAY['owner'::"text"]));



CREATE POLICY "Workspace staff can create reservations" ON "public"."reservations" FOR INSERT WITH CHECK ("public"."can_operate_restaurant"("restaurant_id"));



CREATE POLICY "Workspace staff can update reservations" ON "public"."reservations" FOR UPDATE USING ("public"."can_operate_restaurant"("restaurant_id")) WITH CHECK ("public"."can_operate_restaurant"("restaurant_id"));



ALTER TABLE "public"."admin_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_checkout_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_provider_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_mutations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_cancellation_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_restaurant_import_rows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_restaurant_imports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_user_controls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_user_directory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."public_reservation_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reservation_areas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reservation_management_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reservations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_claim_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_media" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_invitation_restaurants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_member_restaurants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_pwa_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_usage_periods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."assign_default_workspace_subscription"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."can_manage_restaurant_asset_path"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_restaurant_asset_path"("object_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."consume_reservation_quota"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."enforce_workspace_member_limit"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."enforce_workspace_restaurant_limit"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ensure_restaurant_acquisition_dependencies"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."provision_restaurant_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text", "target_workspace_id" "uuid", "target_owner_user_id" "uuid", "target_restaurant_status" "text", "target_claim_status" "text", "target_source" "text", "target_business_contact_email" "text", "target_official_website_url" "text", "target_official_domain" "text", "target_source_import_id" "uuid", "target_profile" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."remove_platform_user_directory"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."sync_platform_user_directory"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."update_platform_restaurant_from_import"("target_restaurant_id" "uuid", "target_payload" "jsonb", "target_provided_fields" "text"[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."workspace_feature_enabled"("target_workspace_id" "uuid", "target_feature" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."workspace_feature_enabled"("target_workspace_id" "uuid", "target_feature" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."accept_workspace_invitation"("target_token_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_workspace_invitation"("target_token_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_workspace_invitation"("target_token_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bootstrap_initial_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bootstrap_initial_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_initial_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_operate_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_operate_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_operate_restaurant"("target_restaurant_id" "uuid", "target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_restaurant_claim"("target_restaurant_id" "uuid", "target_user_id" "uuid", "target_verified_email" "text", "target_verification_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_restaurant_claim"("target_restaurant_id" "uuid", "target_user_id" "uuid", "target_verified_email" "text", "target_verification_method" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_public_reservation_rate_limit"("p_key_hash" "text", "p_window_seconds" integer, "p_max_attempts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_public_reservation_rate_limit"("p_key_hash" "text", "p_window_seconds" integer, "p_max_attempts" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_reservation_access_records"("target_restaurant_id" "uuid", "target_reservation_id" "uuid", "target_business_email" "text", "target_claim_token_hash" "text", "target_claim_expires_at" timestamp with time zone, "target_manage_token_hash" "text", "target_manage_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_reservation_access_records"("target_restaurant_id" "uuid", "target_reservation_id" "uuid", "target_business_email" "text", "target_claim_token_hash" "text", "target_claim_expires_at" timestamp with time zone, "target_manage_token_hash" "text", "target_manage_expires_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_workspace_invitation"("target_workspace_id" "uuid", "target_email" "text", "target_role" "text", "target_access_mode" "text", "target_selected_restaurant_ids" "uuid"[], "target_token_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_workspace_invitation"("target_workspace_id" "uuid", "target_email" "text", "target_role" "text", "target_access_mode" "text", "target_selected_restaurant_ids" "uuid"[], "target_token_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_workspace_invitation"("target_workspace_id" "uuid", "target_email" "text", "target_role" "text", "target_access_mode" "text", "target_selected_restaurant_ids" "uuid"[], "target_token_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_area_effective_settings"("area_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_area_effective_settings"("area_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_area_effective_settings"("area_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_restaurant_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_restaurant_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_restaurant_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[], "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[], "target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_workspace_role"("target_workspace_id" "uuid", "allowed_roles" "text"[], "target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_workspace_member"("target_workspace_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_workspace_member"("target_workspace_id" "uuid", "target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_workspace_member"("target_workspace_id" "uuid", "target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."provision_restaurant_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text", "target_workspace_id" "uuid", "target_owner_user_id" "uuid", "target_restaurant_status" "text", "target_claim_status" "text", "target_source" "text", "target_business_contact_email" "text", "target_official_website_url" "text", "target_official_domain" "text", "target_source_import_id" "uuid", "target_profile" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."provision_restaurant_workspace"("target_restaurant_name" "text", "target_workspace_name" "text", "target_restaurant_slug" "text", "target_workspace_id" "uuid", "target_owner_user_id" "uuid", "target_restaurant_status" "text", "target_claim_status" "text", "target_source" "text", "target_business_contact_email" "text", "target_official_website_url" "text", "target_official_domain" "text", "target_source_import_id" "uuid", "target_profile" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_platform_restaurant_from_import"("target_restaurant_id" "uuid", "target_payload" "jsonb", "target_provided_fields" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_platform_restaurant_from_import"("target_restaurant_id" "uuid", "target_payload" "jsonb", "target_provided_fields" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_workspace_member"("target_workspace_id" "uuid", "target_member_id" "uuid", "target_role" "text", "target_access_mode" "text", "target_selected_restaurant_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_workspace_member"("target_workspace_id" "uuid", "target_member_id" "uuid", "target_role" "text", "target_access_mode" "text", "target_selected_restaurant_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_workspace_member"("target_workspace_id" "uuid", "target_member_id" "uuid", "target_role" "text", "target_access_mode" "text", "target_selected_restaurant_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_reservation_type"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_reservation_type"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_reservation_type"() TO "service_role";



GRANT ALL ON TABLE "public"."admin_profiles" TO "anon";
GRANT ALL ON TABLE "public"."admin_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."admin_push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."admin_push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."billing_checkout_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."billing_provider_prices" TO "service_role";

GRANT ALL ON TABLE "public"."billing_mutations" TO "service_role";
GRANT ALL ON TABLE "public"."billing_cancellation_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."billing_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."notification_settings" TO "anon";
GRANT ALL ON TABLE "public"."notification_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_settings" TO "service_role";



GRANT ALL ON TABLE "public"."plans" TO "service_role";
GRANT SELECT ON TABLE "public"."plans" TO "anon";
GRANT SELECT ON TABLE "public"."plans" TO "authenticated";



GRANT ALL ON TABLE "public"."platform_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."platform_members" TO "service_role";



GRANT ALL ON TABLE "public"."platform_restaurant_import_rows" TO "service_role";



GRANT ALL ON TABLE "public"."platform_restaurant_imports" TO "service_role";



GRANT ALL ON TABLE "public"."platform_settings" TO "service_role";



GRANT ALL ON TABLE "public"."platform_user_controls" TO "service_role";



GRANT ALL ON TABLE "public"."platform_user_directory" TO "service_role";



GRANT ALL ON TABLE "public"."public_reservation_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."reservation_areas" TO "anon";
GRANT ALL ON TABLE "public"."reservation_areas" TO "authenticated";
GRANT ALL ON TABLE "public"."reservation_areas" TO "service_role";



GRANT ALL ON TABLE "public"."reservation_management_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."reservations" TO "anon";
GRANT ALL ON TABLE "public"."reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."reservations" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_claim_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_claims" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."restaurant_domains" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."restaurant_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_domains" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_media" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_media" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_media" TO "service_role";



GRANT ALL ON TABLE "public"."restaurants" TO "anon";
GRANT ALL ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_overrides" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."workspace_invitation_restaurants" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."workspace_invitation_restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_invitation_restaurants" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."workspace_invitations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."workspace_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_invitations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."workspace_member_restaurants" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."workspace_member_restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_member_restaurants" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."workspace_members" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."workspace_members" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_members" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."workspace_push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_pwa_settings" TO "anon";
GRANT ALL ON TABLE "public"."workspace_pwa_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_pwa_settings" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_subscriptions" TO "service_role";
GRANT SELECT ON TABLE "public"."workspace_subscriptions" TO "authenticated";



GRANT ALL ON TABLE "public"."workspace_usage_periods" TO "service_role";
GRANT SELECT ON TABLE "public"."workspace_usage_periods" TO "authenticated";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
+-- ReserveVia consumer boundary for DataEngine's qualified restaurant leads.
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

-- Private email outbox invocation observability.
create table if not exists public.email_outbox_runs (
  id uuid primary key default gen_random_uuid(),
  invocation_id text not null unique,
  trigger_type text not null default 'cron' check (trigger_type in ('cron', 'manual')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  processed_count integer not null default 0 check (processed_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  retrying_count integer not null default 0 check (retrying_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_code text,
  constraint email_outbox_runs_finished_after_start check (finished_at is null or finished_at >= started_at)
);
create index if not exists email_outbox_runs_started_idx on public.email_outbox_runs (started_at desc);
alter table public.email_outbox_runs enable row level security;
revoke all on public.email_outbox_runs from public, anon, authenticated;
grant all on public.email_outbox_runs to service_role;
comment on table public.email_outbox_runs is 'Private cron/manual invocation health for the durable transactional email outbox.';
notify pgrst, 'reload schema';

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

create or replace function public.claim_dataengine_import_batch(
  target_external_batch_id text,
  target_contract_version text,
  target_api_client_id uuid,
  target_request_hash text,
  target_total_leads integer,
  target_lease_token uuid
)
returns table (batch_id uuid, batch_status text, stored_request_hash text, lease_acquired boolean, replayable boolean)
language plpgsql security definer set search_path = public
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
  select * into batch_row from public.dataengine_import_batches where external_batch_id = btrim(target_external_batch_id) for update;
  if batch_row.request_hash <> lower(target_request_hash) then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  if batch_row.status in ('needs_review', 'partially_approved', 'approved', 'publishing', 'partially_published', 'rejected', 'published') then
    return query select batch_row.id, batch_row.status, batch_row.request_hash, false, true;
    return;
  end if;
  if batch_row.status = 'processing' and batch_row.ingest_lease_until is not null and batch_row.ingest_lease_until > now() and batch_row.ingest_lease_token is distinct from target_lease_token then
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
         last_ingest_error = null, last_error = null, updated_at = now()
   where id = batch_row.id;
  return query select batch_row.id, 'processing'::text, batch_row.request_hash, true, false;
end;
$$;

create or replace function public.claim_dataengine_lead_publish(target_lead_id uuid, target_lease_token uuid)
returns table (claimed boolean, current_status text)
language plpgsql security definer set search_path = public
as $$
declare lead_row public.dataengine_import_leads%rowtype;
begin
  select * into lead_row from public.dataengine_import_leads where id = target_lead_id for update;
  if lead_row.id is null then return query select false, 'missing'::text; return; end if;
  if lead_row.publish_status = 'published' then return query select false, 'published'::text; return; end if;
  if lead_row.claimed_conflict or lead_row.publish_status = 'blocked' then return query select false, 'blocked'::text; return; end if;
  if lead_row.publish_status = 'publishing' and lead_row.publish_lease_until > now() and lead_row.publish_lease_token is distinct from target_lease_token then return query select false, 'publishing'::text; return; end if;
  update public.dataengine_import_leads set publish_status = 'publishing', publish_phase = 'tenant', publish_attempt_count = publish_attempt_count + 1, publish_started_at = now(), publish_lease_token = target_lease_token, publish_lease_until = now() + interval '15 minutes', publish_error = null, review_status = 'approved', updated_at = now() where id = target_lead_id;
  return query select true, 'publishing'::text;
end;
$$;

create or replace function public.provision_dataengine_lead_tenant(
  target_lead_id uuid, target_batch_id uuid, target_restaurant_name text,
  target_business_contact_email text, target_official_website_url text,
  target_official_domain text, target_profile jsonb
)
returns table (workspace_id uuid, restaurant_id uuid, workspace_slug text, restaurant_slug text)
language plpgsql security definer set search_path = public, private
as $$
declare lead_row public.dataengine_import_leads%rowtype; provisioned record;
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
  update public.restaurant_claim_profiles set source = 'dataengine', dataengine_batch_id = target_batch_id,
    business_contact_email = lower(btrim(target_business_contact_email)), normalized_business_contact_email = lower(btrim(target_business_contact_email)),
    official_website_url = nullif(btrim(target_official_website_url), ''), official_domain = nullif(lower(btrim(target_official_domain)), ''), updated_at = now()
    where restaurant_id = provisioned.restaurant_id;
  update public.restaurants set official_website_url = nullif(btrim(target_official_website_url), '') where id = provisioned.restaurant_id;
  update public.dataengine_import_leads set restaurant_id = provisioned.restaurant_id, workspace_id = provisioned.workspace_id, restaurant_slug = provisioned.restaurant_slug, publish_phase = 'tenant_provisioned', updated_at = now() where id = target_lead_id;
  update public.dataengine_import_identities set restaurant_id = provisioned.restaurant_id, updated_at = now() where first_lead_id = target_lead_id;
  return query select provisioned.workspace_id, provisioned.restaurant_id, provisioned.workspace_slug, provisioned.restaurant_slug;
end;
$$;

create or replace function public.finalize_dataengine_lead_publication(target_lead_id uuid, target_restaurant_id uuid, target_public_banner_url text, target_profile jsonb)
returns table (published boolean, final_status text)
language plpgsql security definer set search_path = public
as $$
declare claim_row public.restaurant_claim_profiles%rowtype;
begin
  select * into claim_row from public.restaurant_claim_profiles where restaurant_id = target_restaurant_id for update;
  if claim_row.restaurant_id is null then return query select false, 'missing_claim_profile'::text; return; end if;
  if claim_row.ownership_status = 'claimed' then
    update public.dataengine_import_leads set claimed_conflict = true, publish_status = 'blocked', publish_phase = 'claimed_conflict', conflict_reason = 'Restaurant was claimed before DataEngine publication completed.', claimed_update_suggestion = coalesce(source_payload, '{}'::jsonb), updated_at = now() where id = target_lead_id;
    return query select false, 'claimed_conflict'::text; return;
  end if;
  update public.restaurants set description = nullif(target_profile->>'description', ''), cuisine = nullif(target_profile->>'cuisine', ''), hours = nullif(target_profile->>'hours', ''), location = nullif(target_profile->>'location', ''), phone = nullif(target_profile->>'phone', ''), menu_url = nullif(target_profile->>'menu_url', ''), official_website_url = nullif(target_profile->>'official_website_url', ''), social_links = coalesce(target_profile->'social_links', social_links), primary_image_url = target_public_banner_url, status = 'published' where id = target_restaurant_id;
  update public.dataengine_import_leads set review_status = 'published', readiness_status = 'ready', publish_status = 'published', publish_phase = 'completed', publish_completed_at = now(), publish_lease_token = null, publish_lease_until = null, restaurant_id = target_restaurant_id, conflict_reason = null, reviewed_at = coalesce(reviewed_at, now()), published_at = now(), updated_at = now() where id = target_lead_id;
  update public.dataengine_import_identities set restaurant_id = target_restaurant_id, updated_at = now() where first_lead_id = target_lead_id;
  return query select true, 'published'::text;
end;
$$;

create or replace function public.link_dataengine_identity_to_restaurant(target_lead_id uuid, target_restaurant_id uuid)
returns void language sql security definer set search_path = public
as $$ update public.dataengine_import_identities set restaurant_id = target_restaurant_id, updated_at = now() where first_lead_id = target_lead_id; $$;

create or replace function public.release_dataengine_import_identity(target_lead_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin delete from public.dataengine_import_identities where first_lead_id = target_lead_id; update public.dataengine_import_leads set identity_status = 'released', updated_at = now() where id = target_lead_id; end; $$;

create or replace function public.apply_email_delivery_webhook(
  target_provider_event_id text, target_provider_message_id text, target_event_type text,
  target_event_at timestamptz, target_error text, target_pause_booking boolean, target_payload jsonb
)
returns boolean language plpgsql security definer set search_path = public
as $$
declare inserted_count integer; event_row public.email_delivery_events%rowtype; incoming_status text; current_rank integer; incoming_rank integer;
begin
  insert into public.email_provider_webhook_events (provider_event_id, provider_message_id, event_type, event_at, payload) values (target_provider_event_id, target_provider_message_id, target_event_type, target_event_at, coalesce(target_payload, '{}'::jsonb)) on conflict (provider_event_id) do nothing;
  get diagnostics inserted_count = row_count;
  -- Replay duplicate provider events as well; state ranking keeps this monotonic.
  incoming_status := case target_event_type when 'email.delivered' then 'delivered' when 'email.bounced' then 'bounced' when 'email.failed' then 'failed' when 'email.complained' then 'failed' when 'email.suppressed' then 'failed' else null end;
  if incoming_status is null then return true; end if;
  select * into event_row from public.email_delivery_events where provider = 'resend' and provider_message_id = target_provider_message_id for update;
  if event_row.id is null then return true; end if;
  current_rank := case event_row.status when 'bounced' then 50 when 'failed' then 40 when 'delivered' then 30 when 'sent' then 20 else 10 end;
  incoming_rank := case incoming_status when 'bounced' then 50 when 'failed' then 40 when 'delivered' then 30 else 20 end;
  if incoming_rank >= current_rank then update public.email_delivery_events set status = incoming_status, delivered_at = case when incoming_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end, failed_at = case when incoming_status in ('failed', 'bounced') then coalesce(failed_at, now()) else failed_at end, last_error = case when incoming_status in ('failed', 'bounced') then left(coalesce(target_error, incoming_status), 2000) else last_error end, last_provider_event_at = coalesce(target_event_at, now()), updated_at = now(), metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_provider_event', target_event_type) where id = event_row.id; end if;
  if target_pause_booking and incoming_status in ('failed', 'bounced') then update public.restaurant_claim_profiles set business_email_delivery_status = 'hard_bounce', business_email_last_error = left(coalesce(target_error, incoming_status), 2000), business_email_paused_at = coalesce(business_email_paused_at, now()), updated_at = now() where restaurant_id = event_row.restaurant_id and source = 'dataengine' and ownership_status in ('unclaimed', 'claim_pending'); end if;
  return true;
end;
$$;

create or replace function public.claim_email_delivery_event(target_event_id uuid, target_lease_token uuid)
returns table (claimed boolean, payload jsonb, attempt_count integer, max_attempts integer, current_status text)
language plpgsql security definer set search_path = public
as $$
declare event_row public.email_delivery_events%rowtype;
begin
  select * into event_row from public.email_delivery_events where id = target_event_id for update;
  if event_row.id is null then return query select false, '{}'::jsonb, 0, 0, 'missing'::text; return; end if;
  if event_row.status in ('sent', 'delivered', 'bounced', 'paused') then return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return; end if;
  if event_row.status = 'sending' and event_row.lease_until > now() and event_row.lease_token is distinct from target_lease_token then return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return; end if;
  if event_row.next_attempt_at is not null and event_row.next_attempt_at > now() then return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return; end if;
  if event_row.attempt_count >= event_row.max_attempts then update public.email_delivery_events set status = 'failed', failed_at = coalesce(failed_at, now()), updated_at = now() where id = target_event_id; return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, 'failed'::text; return; end if;
  update public.email_delivery_events set status = 'sending', attempt_count = attempt_count + 1, last_attempt_at = now(), lease_token = target_lease_token, lease_until = now() + interval '5 minutes', updated_at = now() where id = target_event_id;
  return query select true, event_row.payload, event_row.attempt_count + 1, event_row.max_attempts, 'sending'::text;
end;
$$;

alter table public.email_provider_webhook_events enable row level security;
revoke all on public.email_provider_webhook_events from public, anon, authenticated;
grant all on public.email_provider_webhook_events to service_role;
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
create index if not exists email_delivery_attempts_event_idx on public.email_delivery_attempts (delivery_event_id, attempt_number desc);
alter table public.email_delivery_attempts enable row level security;
revoke all on public.email_delivery_attempts from public, anon, authenticated;
grant all on public.email_delivery_attempts to service_role;

create or replace function public.claim_email_delivery_event(target_event_id uuid, target_lease_token uuid)
returns table (claimed boolean, payload jsonb, attempt_count integer, max_attempts integer, current_status text)
language plpgsql security definer set search_path = public
as $$
declare event_row public.email_delivery_events%rowtype;
begin
  select * into event_row from public.email_delivery_events where id = target_event_id for update;
  if event_row.id is null then return query select false, '{}'::jsonb, 0, 0, 'missing'::text; return; end if;
  if event_row.status in ('sent', 'delivered', 'bounced', 'paused') then return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return; end if;
  if event_row.status = 'sending' and event_row.lease_until > now() and event_row.lease_token is distinct from target_lease_token then return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return; end if;
  if event_row.next_attempt_at is not null and event_row.next_attempt_at > now() then return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, event_row.status; return; end if;
  if event_row.attempt_count >= event_row.max_attempts then update public.email_delivery_events set status = 'failed', failed_at = coalesce(failed_at, now()), updated_at = now() where id = target_event_id; return query select false, event_row.payload, event_row.attempt_count, event_row.max_attempts, 'failed'::text; return; end if;
  update public.email_delivery_events set status = 'sending', attempt_count = attempt_count + 1, last_attempt_at = now(), lease_token = target_lease_token, lease_until = now() + interval '5 minutes', updated_at = now() where id = target_event_id;
  insert into public.email_delivery_attempts (delivery_event_id, attempt_number, status) values (target_event_id, event_row.attempt_count + 1, 'sending') on conflict (delivery_event_id, attempt_number) do nothing;
  return query select true, event_row.payload, event_row.attempt_count + 1, event_row.max_attempts, 'sending'::text;
end;
$$;
revoke all on function public.claim_email_delivery_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_delivery_event(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
