-- Generic product-first Workspace provisioning.
-- Product resources remain outside Core; this migration only adds the
-- authenticated, idempotent Workspace boundary used by deferred onboarding.

create or replace function private.provision_workspace(
  actor uuid,
  target_workspace_name text,
  target_workspace_slug text,
  reuse_existing boolean,
  preferred_workspace_id uuid default null
)
returns table (workspace_id uuid, workspace_slug text)
language plpgsql security definer set search_path = public, private
as $$
declare
  existing_workspace public.workspaces%rowtype;
  workspace public.workspaces%rowtype;
  owner_count integer;
  workspace_limit integer;
  plan_limits jsonb;
  default_plan_key text;
  base_slug text := lower(trim(both '-' from regexp_replace(coalesce(nullif(btrim(target_workspace_slug), ''), target_workspace_name), '[^a-zA-Z0-9]+', '-', 'g')));
  candidate_slug text;
  suffix integer := 2;
begin
  if actor is null then raise exception using message = 'AUTH_REQUIRED'; end if;
  if length(btrim(coalesce(target_workspace_name, ''))) not between 1 and 120 then raise exception using message = 'INVALID_WORKSPACE_NAME'; end if;

  -- Serialize all initial provisioning attempts for one account. The second
  -- request re-checks membership after waiting, so retries cannot create a
  -- second Workspace when the first response was lost.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  if reuse_existing then
    select candidate.* into existing_workspace
    from public.workspaces as candidate
    join public.workspace_members as member on member.workspace_id = candidate.id
    where member.user_id = actor and candidate.status = 'active' and candidate.platform_status = 'active'
    order by case when candidate.id = preferred_workspace_id then 0 else 1 end,
      member.created_at asc, candidate.created_at asc
    limit 1;
    if found then
      return query select existing_workspace.id, existing_workspace.slug;
      return;
    end if;
  end if;

  select count(*)::integer into owner_count
  from public.workspace_members
  where user_id = actor and role = 'owner';

  default_plan_key := private.core_default_plan_key();
  if default_plan_key is null then
    raise exception using message = 'PLAN_NOT_CONFIGURED';
  end if;
  select limits into plan_limits
  from public.plans
  where key = default_plan_key and active;
  if plan_limits is null or not (plan_limits ? 'core.workspaces') then
    raise exception using message = 'WORKSPACE_LIMIT_NOT_CONFIGURED';
  end if;
  workspace_limit := case
    when plan_limits ->> 'core.workspaces' = 'null' then null
    else nullif(plan_limits ->> 'core.workspaces', '')::integer
  end;
  if workspace_limit is not null and owner_count >= workspace_limit then
    raise exception using message = 'WORKSPACE_LIMIT_REACHED';
  end if;

  if base_slug = '' then base_slug := 'workspace'; end if;
  if base_slug in ('www', 'app', 'api', 'admin', 'manage', 'login', 'signup', 'reset-password', 'onboarding', 'platform', 'assets', 'static') then
    raise exception using message = 'SLUG_RESERVED';
  end if;
  candidate_slug := left(base_slug, 63);

  -- The unique index is authoritative. A concurrent account can win the
  -- preferred slug between any read and insert, so retry the insert with a
  -- bounded-length suffix instead of using check-then-insert as protection.
  loop
    begin
      insert into public.workspaces (name, slug, created_by, onboarding_completed_at)
      values (btrim(target_workspace_name), candidate_slug, actor, now())
      returning * into workspace;
      exit;
    exception when unique_violation then
      candidate_slug := left(base_slug, greatest(1, 63 - length(suffix::text) - 1)) || '-' || suffix::text;
      suffix := suffix + 1;
    end;
  end loop;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace.id, actor, 'owner');
  return query select workspace.id, workspace.slug;
end;
$$;

revoke all on function private.provision_workspace(uuid, text, text, boolean, uuid) from public, anon, authenticated;

create or replace function public.bootstrap_initial_workspace(target_workspace_name text, target_workspace_slug text default null)
returns table (workspace_id uuid, workspace_slug text)
language plpgsql security definer set search_path = public, private
as $$
begin
  return query select * from private.provision_workspace(auth.uid(), target_workspace_name, target_workspace_slug, false, null);
end;
$$;

create or replace function public.ensure_initial_workspace(target_workspace_name text)
returns table (workspace_id uuid, workspace_slug text)
language plpgsql security definer set search_path = public, private
as $$
begin
  return query select * from private.provision_workspace(auth.uid(), target_workspace_name, null, true, null);
end;
$$;

create or replace function public.ensure_initial_workspace(target_workspace_name text, target_workspace_id uuid)
returns table (workspace_id uuid, workspace_slug text)
language plpgsql security definer set search_path = public, private
as $$
begin
  return query select * from private.provision_workspace(auth.uid(), target_workspace_name, null, true, target_workspace_id);
end;
$$;

revoke all on function public.ensure_initial_workspace(text) from public, anon;
revoke all on function public.ensure_initial_workspace(text, uuid) from public, anon;
grant execute on function public.ensure_initial_workspace(text) to authenticated;
grant execute on function public.ensure_initial_workspace(text, uuid) to authenticated;
grant execute on function public.bootstrap_initial_workspace(text, text) to authenticated;
