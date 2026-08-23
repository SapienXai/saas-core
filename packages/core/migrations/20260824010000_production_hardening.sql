-- SaaS Core v1 production hardening.
-- Sensitive mutations are RPC-only. Browser clients can read through RLS, but
-- cannot forge membership, commercial, invitation, PWA, or push state.

alter table public.workspace_invitations add column if not exists last_sent_at timestamptz;
alter table public.workspace_invitations add column if not exists resend_count integer not null default 0;
alter table public.plans add column if not exists sort_order integer not null default 0;
alter table public.workspace_subscriptions add column if not exists billing_interval text;
alter table public.workspace_subscriptions add column if not exists billing_currency text;
alter table public.workspace_subscriptions add column if not exists provider_price_id text;

create unique index if not exists workspace_members_single_owner_idx
  on public.workspace_members(workspace_id) where role = 'owner';
create unique index if not exists workspace_invitations_pending_email_idx
  on public.workspace_invitations(workspace_id, normalized_email) where status = 'pending';

create or replace function private.effective_plan_key(target_workspace uuid, target_at timestamptz default now())
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  result text;
  override_plan text;
  scheduled_plan text;
  scheduled_at timestamptz;
  current_status text;
  grace_ends_at timestamptz;
begin
  select s.plan_key, s.status, s.payment_grace_ends_at, s.scheduled_plan_key, s.scheduled_plan_at
    into result, current_status, grace_ends_at, scheduled_plan, scheduled_at
    from public.workspace_subscriptions s
   where s.workspace_id = target_workspace;
  if result is null then return 'free'; end if;

  select o.plan_key into override_plan
    from public.subscription_overrides o
   where o.workspace_id = target_workspace
     and o.revoked_at is null
     and o.effective_from <= target_at
     and (o.effective_until is null or o.effective_until > target_at)
   order by o.effective_from desc, o.created_at desc
   limit 1;
  if override_plan is not null then return override_plan; end if;
  if current_status in ('paused', 'canceled') then return 'free'; end if;
  if scheduled_plan is not null and scheduled_at is not null and scheduled_at <= target_at then return scheduled_plan; end if;
  if current_status = 'past_due' and grace_ends_at is not null and grace_ends_at <= target_at then return 'free'; end if;
  return result;
end;
$$;

create or replace function private.effective_plan_limit(target_workspace uuid, target_metric text, target_at timestamptz default now())
returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select nullif((p.limits ->> target_metric), '')::bigint
    from public.plans p
   where p.key = private.effective_plan_key(target_workspace, target_at)
     and p.active = true;
$$;

create or replace function public.create_workspace(target_name text, target_slug text, target_timezone text default 'UTC')
returns setof public.workspaces
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  created public.workspaces;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'UNAUTHENTICATED'; end if;
  if length(trim(target_name)) not between 1 and 120 then raise exception using errcode = '22023', message = 'INVALID_WORKSPACE_NAME'; end if;
  insert into public.workspaces(name, slug, created_by, preferred_timezone)
  values (trim(target_name), lower(trim(target_slug)), auth.uid(), coalesce(nullif(trim(target_timezone), ''), 'UTC'))
  returning * into created;
  insert into public.workspace_members(workspace_id, user_id, role) values (created.id, auth.uid(), 'owner');
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, after_data)
  values (auth.uid(), 'workspace.created', 'workspace', created.id::text, jsonb_build_object('slug', created.slug, 'name', created.name));
  return next created;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'WORKSPACE_SLUG_TAKEN';
end;
$$;

create or replace function public.update_workspace(target_workspace uuid, target_name text default null, target_timezone text default null, target_onboarding_completed boolean default null)
returns setof public.workspaces
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  updated public.workspaces;
begin
  if not private.current_user_has_workspace_role(target_workspace, array['owner','admin']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  update public.workspaces
     set name = coalesce(nullif(trim(target_name), ''), name),
         preferred_timezone = coalesce(nullif(trim(target_timezone), ''), preferred_timezone),
         onboarding_completed_at = case when target_onboarding_completed is null then onboarding_completed_at when target_onboarding_completed then coalesce(onboarding_completed_at, now()) else null end,
         updated_at = now()
   where id = target_workspace
  returning * into updated;
  if updated.id is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  return next updated;
end;
$$;

create or replace function public.archive_workspace(target_workspace uuid)
returns setof public.workspaces
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_has_workspace_role(target_workspace, array['owner']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query update public.workspaces set status = 'archived', updated_at = now() where id = target_workspace returning *;
end;
$$;

create or replace function public.change_member_role(target_workspace uuid, target_user uuid, target_role text)
returns setof public.workspace_members
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  current_member public.workspace_members;
  updated public.workspace_members;
begin
  select m.role into actor_role from public.workspace_members m where m.workspace_id = target_workspace and m.user_id = auth.uid() and m.status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select * into current_member from public.workspace_members where workspace_id = target_workspace and user_id = target_user for update;
  if current_member.id is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if current_member.role = 'owner' or target_role = 'owner' then raise exception using errcode = '42501', message = 'OWNER_PROTECTED'; end if;
  if actor_role = 'admin' and (current_member.role = 'admin' or target_role = 'admin') then raise exception using errcode = '42501', message = 'ROLE_HIERARCHY'; end if;
  if target_role not in ('admin', 'manager', 'member', 'viewer') then raise exception using errcode = '22023', message = 'INVALID_ROLE'; end if;
  update public.workspace_members set role = target_role, updated_at = now() where id = current_member.id returning * into updated;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'member.role_changed', 'membership', updated.id::text, jsonb_build_object('role', current_member.role, 'userId', target_user), jsonb_build_object('role', updated.role, 'userId', target_user));
  return next updated;
end;
$$;

create or replace function public.remove_member(target_workspace uuid, target_user uuid)
returns setof public.workspace_members
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  target_member public.workspace_members;
begin
  select m.role into actor_role from public.workspace_members m where m.workspace_id = target_workspace and m.user_id = auth.uid() and m.status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select * into target_member from public.workspace_members where workspace_id = target_workspace and user_id = target_user for update;
  if target_member.id is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if target_member.role = 'owner' then raise exception using errcode = '42501', message = 'OWNER_PROTECTED'; end if;
  if actor_role = 'admin' and target_member.role = 'admin' then raise exception using errcode = '42501', message = 'ROLE_HIERARCHY'; end if;
  update public.workspace_members set status = 'suspended', updated_at = now() where id = target_member.id returning *;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'member.removed', 'membership', target_member.id::text, jsonb_build_object('status', target_member.status), jsonb_build_object('status', 'suspended', 'userId', target_user));
  return next target_member;
end;
$$;

create or replace function public.create_workspace_invitation(target_workspace uuid, target_email text, target_role text, target_token_hash text, target_expires_at timestamptz)
returns setof public.workspace_invitations
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  invitation public.workspace_invitations;
  actor_role text;
  seat_limit bigint;
  active_seats bigint;
  pending_seats bigint;
  normalized text := lower(trim(target_email));
begin
  select role into actor_role from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid() and status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if target_role not in ('admin', 'manager', 'member', 'viewer') or (actor_role = 'admin' and target_role = 'admin') then raise exception using errcode = '42501', message = 'ROLE_HIERARCHY'; end if;
  if exists (select 1 from public.workspace_invitations where workspace_id = target_workspace and normalized_email = normalized and status = 'pending' and expires_at > now()) then raise exception using errcode = '23505', message = 'DUPLICATE_INVITATION'; end if;
  select private.effective_plan_limit(target_workspace, 'users') into seat_limit;
  select count(*) into active_seats from public.workspace_members where workspace_id = target_workspace and status = 'active';
  select count(*) into pending_seats from public.workspace_invitations where workspace_id = target_workspace and status = 'pending' and expires_at > now();
  if seat_limit is not null and active_seats + pending_seats + 1 > seat_limit then raise exception using errcode = 'P0001', message = 'LIMIT_REACHED'; end if;
  insert into public.workspace_invitations(workspace_id, normalized_email, role, token_hash, invited_by, expires_at, last_sent_at)
  values (target_workspace, normalized, target_role, lower(target_token_hash), auth.uid(), least(target_expires_at, now() + interval '30 days'), now())
  returning * into invitation;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, after_data)
  values (auth.uid(), 'invitation.created', 'invitation', invitation.id::text, jsonb_build_object('workspaceId', target_workspace, 'email', normalized, 'role', target_role));
  return next invitation;
end;
$$;

create or replace function public.resend_workspace_invitation(target_invitation uuid, target_token_hash text)
returns setof public.workspace_invitations
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  invitation public.workspace_invitations;
  actor_role text;
begin
  select * into invitation from public.workspace_invitations where id = target_invitation for update;
  if invitation.id is null or invitation.status <> 'pending' then raise exception using errcode = 'P0001', message = 'INVITATION_INVALID'; end if;
  select role into actor_role from public.workspace_members where workspace_id = invitation.workspace_id and user_id = auth.uid() and status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if invitation.last_sent_at is not null and invitation.last_sent_at > now() - interval '60 seconds' then raise exception using errcode = 'P0001', message = 'INVITATION_RESEND_COOLDOWN'; end if;
  update public.workspace_invitations set token_hash = lower(target_token_hash), last_sent_at = now(), resend_count = resend_count + 1, email_delivery_status = 'pending' where id = invitation.id returning * into invitation;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, after_data)
  values (auth.uid(), 'invitation.resent', 'invitation', invitation.id::text, jsonb_build_object('resendCount', invitation.resend_count));
  return next invitation;
end;
$$;

create or replace function public.revoke_workspace_invitation(target_invitation uuid)
returns setof public.workspace_invitations
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  invitation public.workspace_invitations;
  actor_role text;
begin
  select * into invitation from public.workspace_invitations where id = target_invitation for update;
  if invitation.id is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  select role into actor_role from public.workspace_members where workspace_id = invitation.workspace_id and user_id = auth.uid() and status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  update public.workspace_invitations set status = 'revoked', revoked_at = now() where id = invitation.id returning * into invitation;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, after_data)
  values (auth.uid(), 'invitation.revoked', 'invitation', invitation.id::text, jsonb_build_object('status', 'revoked'));
  return next invitation;
end;
$$;

create or replace function public.accept_workspace_invitation(target_invitation uuid, target_token_hash text)
returns setof public.workspace_members
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  invitation public.workspace_invitations;
  new_member public.workspace_members;
  account_email text;
  seat_limit bigint;
  active_seats bigint;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'UNAUTHENTICATED'; end if;
  select * into invitation from public.workspace_invitations where id = target_invitation for update;
  select lower(email) into account_email from auth.users where id = auth.uid();
  if invitation.id is null or invitation.status <> 'pending' or invitation.revoked_at is not null or invitation.expires_at <= now() or invitation.token_hash <> lower(target_token_hash) or account_email <> invitation.normalized_email then raise exception using errcode = 'P0001', message = 'INVITATION_INVALID'; end if;
  select private.effective_plan_limit(invitation.workspace_id, 'users') into seat_limit;
  select count(*) into active_seats from public.workspace_members where workspace_id = invitation.workspace_id and status = 'active';
  if seat_limit is not null and active_seats >= seat_limit then raise exception using errcode = 'P0001', message = 'LIMIT_REACHED'; end if;
  insert into public.workspace_members(workspace_id, user_id, role) values (invitation.workspace_id, auth.uid(), invitation.role) returning * into new_member;
  update public.workspace_invitations set status = 'accepted', accepted_at = now() where id = invitation.id;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, after_data)
  values (auth.uid(), 'invitation.accepted', 'invitation', invitation.id::text, jsonb_build_object('membershipId', new_member.id));
  return next new_member;
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'CONFLICT';
end;
$$;

create or replace function public.get_effective_entitlements(target_workspace uuid, target_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  subscription public.workspace_subscriptions;
  plan public.plans;
  effective_key text;
  override_id uuid;
begin
  if not private.current_user_is_workspace_member(target_workspace) and not private.current_user_is_platform_member(array['platform_owner','platform_admin','billing_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select * into subscription from public.workspace_subscriptions where workspace_id = target_workspace;
  effective_key := private.effective_plan_key(target_workspace, target_at);
  select * into plan from public.plans where key = effective_key and active = true;
  select o.id into override_id from public.subscription_overrides o where o.workspace_id = target_workspace and o.revoked_at is null and o.effective_from <= target_at and (o.effective_until is null or o.effective_until > target_at) order by o.effective_from desc limit 1;
  if plan.key is null or subscription.workspace_id is null then raise exception using errcode = 'P0002', message = 'PLAN_UNAVAILABLE'; end if;
  return jsonb_build_object('workspaceId', target_workspace, 'planKey', plan.key, 'planName', plan.name, 'features', plan.features, 'limits', plan.limits, 'subscription', to_jsonb(subscription), 'overrideId', override_id, 'scheduledPlan', case when subscription.scheduled_plan_key is not null and subscription.scheduled_plan_at > target_at then jsonb_build_object('key', subscription.scheduled_plan_key, 'effectiveAt', subscription.scheduled_plan_at) else null end);
end;
$$;

create or replace function public.consume_usage(target_workspace uuid, target_metric text, increment_by bigint default 1, target_period_start date default null, target_period_end date default null)
returns table (period_start date, period_end date, amount bigint, remaining bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  bucket_start date := coalesce(target_period_start, date_trunc('month', timezone('utc', now()))::date);
  bucket_end date := coalesce(target_period_end, (date_trunc('month', timezone('utc', now())) + interval '1 month')::date);
  usage_limit bigint;
  current_amount bigint;
begin
  if not private.current_user_is_workspace_member(target_workspace) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if increment_by < 1 or target_metric !~ '^[a-z][a-z0-9_.-]{0,95}$' or bucket_end <= bucket_start then raise exception using errcode = '22023', message = 'INVALID_USAGE_REQUEST'; end if;
  usage_limit := private.effective_plan_limit(target_workspace, target_metric, now());
  insert into public.workspace_usage_periods(workspace_id, metric, period_start, period_end, amount) values (target_workspace, target_metric, bucket_start, bucket_end, 0) on conflict on constraint workspace_usage_periods_pkey do nothing;
  select u.amount into current_amount from public.workspace_usage_periods as u where u.workspace_id = target_workspace and u.metric = target_metric and u.period_start = bucket_start for update;
  if usage_limit is not null and current_amount + increment_by > usage_limit then raise exception using errcode = 'P0001', message = 'LIMIT_REACHED'; end if;
  update public.workspace_usage_periods set amount = current_amount + increment_by, updated_at = now() where workspace_usage_periods.workspace_id = target_workspace and workspace_usage_periods.metric = target_metric and workspace_usage_periods.period_start = bucket_start returning workspace_usage_periods.period_start, workspace_usage_periods.period_end, workspace_usage_periods.amount into period_start, period_end, amount;
  remaining := case when usage_limit is null then null else greatest(0, usage_limit - amount) end;
  return next;
end;
$$;

drop function if exists public.create_workspace_domain(text);
create or replace function public.create_workspace_domain(target_workspace uuid, target_hostname text)
returns setof public.workspace_domains
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  workspace_id uuid;
  hostname text := lower(trim(regexp_replace(target_hostname, '^https?://', '')));
  created public.workspace_domains;
begin
  hostname := regexp_replace(hostname, '/.*$', '');
  if hostname ~ '^[0-9.]+$' or hostname in ('localhost', 'www', 'app', 'platform') or hostname !~ '^[a-z0-9][a-z0-9.-]+[a-z0-9]$' then raise exception using errcode = '22023', message = 'INVALID_HOSTNAME'; end if;
  select m.workspace_id into workspace_id from public.workspace_members m where m.workspace_id = target_workspace and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin');
  if workspace_id is null or (select (p.features ->> 'customDomain')::boolean from public.plans p where p.key = private.effective_plan_key(workspace_id)) is not true then raise exception using errcode = '42501', message = 'FEATURE_NOT_INCLUDED'; end if;
  insert into public.workspace_domains(workspace_id, hostname) values (workspace_id, hostname) returning * into created;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, after_data) values (auth.uid(), 'domain.created', 'domain', created.id::text, jsonb_build_object('hostname', hostname, 'workspaceId', workspace_id));
  return next created;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'DOMAIN_ALREADY_EXISTS';
end;
$$;

create or replace function public.upsert_workspace_pwa_settings(target_workspace uuid, target_app_name text default null, target_icon_url text default null, target_theme_color text default null, target_background_color text default null)
returns setof public.workspace_pwa_settings
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_has_workspace_role(target_workspace, array['owner','admin']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  insert into public.workspace_pwa_settings(workspace_id, app_name, icon_url, theme_color, background_color)
  values (target_workspace, target_app_name, target_icon_url, target_theme_color, target_background_color)
  on conflict (workspace_id) do update set app_name = excluded.app_name, icon_url = excluded.icon_url, theme_color = excluded.theme_color, background_color = excluded.background_color, updated_at = now();
  return query select * from public.workspace_pwa_settings where workspace_id = target_workspace;
end;
$$;

create or replace function public.upsert_push_subscription(target_workspace uuid, target_endpoint text, target_p256dh text, target_auth text)
returns setof public.workspace_push_subscriptions
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_is_workspace_member(target_workspace) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  insert into public.workspace_push_subscriptions(workspace_id, user_id, endpoint, p256dh, auth, status)
  values (target_workspace, auth.uid(), target_endpoint, target_p256dh, target_auth, 'active')
  on conflict (workspace_id, user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, status = 'active', updated_at = now();
  return query select * from public.workspace_push_subscriptions where workspace_id = target_workspace and user_id = auth.uid() and endpoint = target_endpoint;
end;
$$;

create or replace function public.revoke_push_subscription(target_workspace uuid, target_endpoint text)
returns setof public.workspace_push_subscriptions
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_is_workspace_member(target_workspace) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  update public.workspace_push_subscriptions set status = 'revoked', updated_at = now() where workspace_id = target_workspace and user_id = auth.uid() and endpoint = target_endpoint returning *;
  return query select * from public.workspace_push_subscriptions where workspace_id = target_workspace and user_id = auth.uid() and endpoint = target_endpoint;
end;
$$;

create or replace function public.core_health_check()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  required_tables text[] := array['workspaces','workspace_members','plans','workspace_subscriptions','workspace_usage_periods','workspace_invitations','billing_webhook_events','audit_events','platform_members','workspace_domains','workspace_pwa_settings','workspace_push_subscriptions'];
  missing text[];
begin
  select coalesce(array_agg(name order by name), '{}'::text[]) into missing from unnest(required_tables) as name where to_regclass('public.' || name) is null;
  return jsonb_build_object('ok', coalesce(array_length(missing, 1), 0) = 0, 'missingTables', missing, 'rls', (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any(required_tables)));
end;
$$;

create or replace function public.platform_list_workspaces()
returns table (id uuid, name text, slug text, status text, plan_key text, subscription_status text, member_count bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','billing_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select w.id, w.name, w.slug, w.status, s.plan_key, s.status, (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'), w.created_at from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id order by w.created_at desc;
end;
$$;

create or replace function public.platform_support_view(target_workspace uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  result jsonb;
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select jsonb_build_object('workspace', to_jsonb(w), 'subscription', to_jsonb(s), 'members', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.workspace_members m where m.workspace_id = w.id), '[]'::jsonb), 'entitlements', public.get_effective_entitlements(target_workspace)) into result from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id where w.id = target_workspace;
  if result is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'platform.support.view', 'workspace', target_workspace::text, jsonb_build_object('mode', 'read_only'));
  return result;
end;
$$;

-- Remove broad direct mutation paths. Sensitive writes above are the only
-- authenticated entry points; service_role remains available for jobs.
drop policy if exists workspace_owner_update on public.workspaces;
drop policy if exists workspace_members_mutate on public.workspace_members;

revoke all on function public.create_workspace(text, text, text) from public, anon;
revoke all on function public.update_workspace(uuid, text, text, boolean) from public, anon;
revoke all on function public.archive_workspace(uuid) from public, anon;
revoke all on function public.change_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.create_workspace_invitation(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function public.resend_workspace_invitation(uuid, text) from public, anon;
revoke all on function public.revoke_workspace_invitation(uuid) from public, anon;
revoke all on function public.accept_workspace_invitation(uuid, text) from public, anon;
revoke all on function public.get_effective_entitlements(uuid, timestamptz) from public, anon;
revoke all on function public.consume_usage(uuid, text, bigint, date, date) from public, anon;
revoke all on function public.create_workspace_domain(uuid, text) from public, anon;
revoke all on function public.upsert_workspace_pwa_settings(uuid, text, text, text, text) from public, anon;
revoke all on function public.upsert_push_subscription(uuid, text, text, text) from public, anon;
revoke all on function public.revoke_push_subscription(uuid, text) from public, anon;
revoke all on function public.core_health_check() from public, anon;
revoke all on function public.platform_list_workspaces() from public, anon;
revoke all on function public.platform_support_view(uuid) from public, anon;

grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.update_workspace(uuid, text, text, boolean) to authenticated;
grant execute on function public.archive_workspace(uuid) to authenticated;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.create_workspace_invitation(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.resend_workspace_invitation(uuid, text) to authenticated;
grant execute on function public.revoke_workspace_invitation(uuid) to authenticated;
grant execute on function public.accept_workspace_invitation(uuid, text) to authenticated;
grant execute on function public.get_effective_entitlements(uuid, timestamptz) to authenticated;
grant execute on function public.consume_usage(uuid, text, bigint, date, date) to authenticated;
grant execute on function public.create_workspace_domain(uuid, text) to authenticated;
grant execute on function public.upsert_workspace_pwa_settings(uuid, text, text, text, text) to authenticated;
grant execute on function public.upsert_push_subscription(uuid, text, text, text) to authenticated;
grant execute on function public.revoke_push_subscription(uuid, text) to authenticated;
grant execute on function public.core_health_check() to authenticated, service_role;
grant execute on function public.platform_list_workspaces() to authenticated;
grant execute on function public.platform_support_view(uuid) to authenticated;

insert into public.saas_core_schema_versions(version, package_version) values ('1.1-hardening', '1.0.0') on conflict (version) do update set package_version = excluded.package_version;
