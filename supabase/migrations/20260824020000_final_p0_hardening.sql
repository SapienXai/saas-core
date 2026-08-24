-- SaaS Core v1 final P0 hardening.
-- This migration is additive: existing Core migrations remain immutable.

alter table public.workspace_invitations add column if not exists provider_message_id text;
alter table public.workspace_invitations add column if not exists delivery_error text;
create index if not exists billing_webhook_events_failed_idx on public.billing_webhook_events(created_at desc) where status = 'failed';

-- A single transaction-level advisory lock serializes invitation creation and
-- acceptance for the same workspace. Locking the invitation row alone cannot
-- protect two concurrent seat-count decisions for different invitations.
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
  perform pg_advisory_xact_lock(hashtextextended(target_workspace::text, 0));
  select role into actor_role from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid() and status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if target_role not in ('admin', 'manager', 'member', 'viewer') or (actor_role = 'admin' and target_role = 'admin') then raise exception using errcode = '42501', message = 'ROLE_HIERARCHY'; end if;
  if exists (select 1 from public.workspace_invitations where workspace_id = target_workspace and normalized_email = normalized and status = 'pending' and expires_at > now()) then raise exception using errcode = '23505', message = 'DUPLICATE_INVITATION'; end if;
  select private.effective_plan_limit(target_workspace, 'users') into seat_limit;
  select count(*) into active_seats from public.workspace_members where workspace_id = target_workspace and status = 'active';
  select count(*) into pending_seats from public.workspace_invitations where workspace_id = target_workspace and status = 'pending' and expires_at > now();
  if seat_limit is not null and active_seats + pending_seats + 1 > seat_limit then raise exception using errcode = 'P0001', message = 'LIMIT_REACHED'; end if;
  insert into public.workspace_invitations(workspace_id, normalized_email, role, token_hash, invited_by, expires_at, last_sent_at)
  values (target_workspace, normalized, target_role, lower(target_token_hash), auth.uid(), least(target_expires_at, now() + interval '30 days'), now()) returning * into invitation;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, after_data)
  values (auth.uid(), 'invitation.created', 'invitation', invitation.id::text, jsonb_build_object('workspaceId', target_workspace, 'email', normalized, 'role', target_role));
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
  perform pg_advisory_xact_lock(hashtextextended(invitation.workspace_id::text, 0));
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

create or replace function public.mark_invitation_delivery(target_invitation uuid, target_status text, target_provider_message_id text default null, target_error text default null)
returns setof public.workspace_invitations
language plpgsql security definer set search_path = public, pg_temp as $$
declare updated public.workspace_invitations;
begin
  if target_status not in ('sent', 'failed') then raise exception using errcode = '22023', message = 'INVALID_DELIVERY_STATUS'; end if;
  update public.workspace_invitations set email_delivery_status = target_status, provider_message_id = target_provider_message_id, delivery_error = left(target_error, 2000) where id = target_invitation returning * into updated;
  if updated.id is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  return next updated;
end;
$$;

create or replace function public.expire_payment_grace(target_at timestamptz default now())
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  update public.workspace_subscriptions set plan_key = 'free', billing_issue_code = 'grace_expired', updated_at = now()
   where status = 'past_due' and payment_grace_ends_at is not null and payment_grace_ends_at <= target_at;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.platform_workspace_360(target_workspace uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','support','auditor','billing_admin']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'workspace', to_jsonb(w),
    'subscription', to_jsonb(s),
    'members', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.workspace_members m where m.workspace_id = w.id), '[]'::jsonb),
    'entitlements', public.get_effective_entitlements(target_workspace),
    'usage', coalesce((select jsonb_agg(to_jsonb(u) order by u.metric, u.period_start desc) from public.workspace_usage_periods u where u.workspace_id = w.id), '[]'::jsonb),
    'domains', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from public.workspace_domains d where d.workspace_id = w.id), '[]'::jsonb),
    'pwa', (select to_jsonb(p) from public.workspace_pwa_settings p where p.workspace_id = w.id),
    'audit', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.audit_events a where a.entity_type = 'workspace' and a.entity_id = w.id::text limit 25), '[]'::jsonb)
  ) into result
  from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id where w.id = target_workspace;
  if result is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'platform.workspace.view', 'workspace', target_workspace::text, jsonb_build_object('mode', 'read_only'));
  return result;
end;
$$;

create or replace function public.platform_list_users()
returns table (id uuid, email varchar, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.email, u.created_at, u.last_sign_in_at from auth.users u where private.current_user_is_platform_member(array['platform_owner','platform_admin','support','auditor']) order by u.created_at desc;
$$;

create or replace function public.platform_health_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare health jsonb; failed_count bigint;
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  health := public.core_health_check();
  select count(*) into failed_count from public.billing_webhook_events where status = 'failed' and created_at >= now() - interval '7 days';
  return health || jsonb_build_object('failedWebhooksLast7Days', failed_count, 'migrationVersion', '1.2-p0');
end;
$$;

revoke all on function public.mark_invitation_delivery(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.expire_payment_grace(timestamptz) from public, anon, authenticated;
revoke all on function public.platform_workspace_360(uuid) from public, anon;
revoke all on function public.platform_list_users() from public, anon;
revoke all on function public.platform_health_snapshot() from public, anon;
grant execute on function public.mark_invitation_delivery(uuid, text, text, text) to service_role;
grant execute on function public.expire_payment_grace(timestamptz) to service_role;
grant execute on function public.platform_workspace_360(uuid) to authenticated;
grant execute on function public.platform_list_users() to authenticated;
grant execute on function public.platform_health_snapshot() to authenticated;

insert into public.saas_core_schema_versions(version, package_version) values ('1.2-p0', '1.0.0') on conflict (version) do update set package_version = excluded.package_version;
