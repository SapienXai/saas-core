-- Reservevia forward migration: first-time self-service account bootstrap.
-- The function is the only public creation path for the initial customer
-- workspace. It uses auth.uid(), creates the owner and first restaurant in one
-- transaction, and is safe to retry after a client/network interruption.

alter table public.workspaces
  add column if not exists onboarding_completed_at timestamptz;

create index if not exists workspaces_created_by_idx on public.workspaces (created_by);

-- A user may have memberships in many workspaces, but can self-create only one
-- Reservevia customer workspace. Existing inherited workspaces have a null
-- created_by and are intentionally unaffected.
create unique index if not exists workspaces_self_service_creator_key
  on public.workspaces (created_by)
  where created_by is not null;

create or replace function public.bootstrap_initial_workspace(
  target_restaurant_name text,
  target_workspace_name text default null,
  target_restaurant_slug text default null
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

revoke all on function public.bootstrap_initial_workspace(text, text, text) from public, anon;
grant execute on function public.bootstrap_initial_workspace(text, text, text) to authenticated;

comment on column public.workspaces.onboarding_completed_at is 'Set when the first self-service restaurant is published. Progress is derived from persisted tenant data.';
comment on function public.bootstrap_initial_workspace(text, text, text) is 'Transactional first-workspace bootstrap. Uses auth.uid(), assigns the trigger-created Free subscription, and is idempotent per self-service owner.';

notify pgrst, 'reload schema';
