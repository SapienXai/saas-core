-- SaaS Core v1.1.1 platform operations and least-privilege hardening.
-- Additive only: earlier migrations remain immutable.

create or replace function private.current_user_platform_role()
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select pm.role
  from public.platform_members pm
  where pm.user_id = auth.uid() and pm.status = 'active'
  limit 1;
$$;

create or replace function private.current_user_has_platform_capability(target_capability text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor_role text := private.current_user_platform_role();
begin
  if actor_role is null then return false; end if;
  if actor_role in ('platform_owner', 'platform_admin') then return true; end if;
  return case target_capability
    when 'platform.workspace.read' then actor_role in ('support', 'auditor')
    when 'platform.user.read' then actor_role = 'support'
    when 'platform.billing.read' then actor_role = 'billing_admin'
    when 'platform.billing.manage' then actor_role = 'billing_admin'
    when 'platform.override.read' then actor_role = 'billing_admin'
    when 'platform.override.manage' then actor_role = 'billing_admin'
    when 'platform.domain.read' then actor_role in ('support', 'auditor')
    when 'platform.domain.manage' then false
    when 'platform.audit.read' then actor_role in ('support', 'auditor')
    when 'platform.health.read' then actor_role in ('support', 'auditor')
    when 'platform.support.read' then actor_role in ('support', 'auditor')
    else false
  end;
end;
$$;

revoke all on function private.current_user_platform_role() from public, anon;
revoke all on function private.current_user_has_platform_capability(text) from public, anon;
grant execute on function private.current_user_platform_role() to authenticated;
grant execute on function private.current_user_has_platform_capability(text) to authenticated;

create or replace function public.core_health_check()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  required_tables text[] := array['workspaces','workspace_members','plans','workspace_subscriptions','workspace_usage_periods','workspace_invitations','billing_webhook_events','audit_events','platform_members','workspace_domains','workspace_pwa_settings','workspace_push_subscriptions'];
  required_functions text[] := array['core_health_check()','platform_list_workspaces()','platform_support_view(uuid)','platform_workspace_360(uuid)','platform_list_users()','platform_health_snapshot()','platform_search(text,integer)','platform_list_overrides(text,integer)','platform_list_subscriptions(integer)','platform_list_domains(integer)','platform_list_audit(uuid,uuid,text,text,integer,integer)','platform_attention(integer)','platform_attention_filtered(integer,text,text)','platform_create_override(uuid,text,text,timestamptz,timestamptz,text)','platform_revoke_override(uuid,text,text)','platform_apply_domain_reconciliation(uuid,text,text,text,boolean,text,text,text)','platform_apply_subscription_reconciliation(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,text,timestamptz,timestamptz,text)'];
  missing_tables text[]; missing_functions text[];
begin
  select coalesce(array_agg(name order by name), '{}'::text[]) into missing_tables from unnest(required_tables) as name where to_regclass('public.' || name) is null;
  select coalesce(array_agg(name order by name), '{}'::text[]) into missing_functions from unnest(required_functions) as name where to_regprocedure('public.' || name) is null;
  return jsonb_build_object('ok', coalesce(array_length(missing_tables, 1), 0) = 0 and coalesce(array_length(missing_functions, 1), 0) = 0, 'missingTables', missing_tables, 'missingFunctions', missing_functions, 'rls', (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any(required_tables)));
end;
$$;

create or replace function public.platform_list_workspaces()
returns table (id uuid, name text, slug text, status text, plan_key text, subscription_status text, member_count bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_has_platform_capability('platform.workspace.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query
    select w.id, w.name, w.slug, w.status, s.plan_key, s.status,
      (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'), w.created_at
    from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id
    order by w.created_at desc limit 500;
end;
$$;

create or replace function public.platform_support_view(target_workspace uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if not private.current_user_has_platform_capability('platform.support.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'workspace', to_jsonb(w),
    'subscription', to_jsonb(s),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'role', m.role, 'status', m.status, 'created_at', m.created_at) order by m.created_at) from public.workspace_members m where m.workspace_id = w.id), '[]'::jsonb),
    'entitlements', public.get_effective_entitlements(target_workspace)
  ) into result
  from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id where w.id = target_workspace;
  if result is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'platform.support.view', 'workspace', target_workspace::text, jsonb_build_object('mode', 'read_only', 'role', private.current_user_platform_role()));
  return result;
end;
$$;

create or replace function public.platform_workspace_360(target_workspace uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb; actor_role text := private.current_user_platform_role();
begin
  if not private.current_user_has_platform_capability('platform.support.read') and not private.current_user_has_platform_capability('platform.billing.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if actor_role = 'billing_admin' then
    select jsonb_build_object(
      'workspace', jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug, 'status', w.status, 'created_at', w.created_at),
      'subscription', to_jsonb(s),
      'members', '[]'::jsonb,
      'entitlements', public.get_effective_entitlements(target_workspace),
      'usage', coalesce((select jsonb_agg(to_jsonb(u) order by u.metric, u.period_start desc) from public.workspace_usage_periods u where u.workspace_id = w.id), '[]'::jsonb),
      'domains', '[]'::jsonb, 'pwa', null, 'audit', '[]'::jsonb
    ) into result
    from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id where w.id = target_workspace;
  else
    select jsonb_build_object(
      'workspace', to_jsonb(w), 'subscription', to_jsonb(s),
      'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'role', m.role, 'status', m.status, 'created_at', m.created_at) order by m.created_at) from public.workspace_members m where m.workspace_id = w.id), '[]'::jsonb),
      'entitlements', public.get_effective_entitlements(target_workspace),
      'usage', coalesce((select jsonb_agg(to_jsonb(u) order by u.metric, u.period_start desc) from public.workspace_usage_periods u where u.workspace_id = w.id), '[]'::jsonb),
      'domains', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'hostname', d.hostname, 'status', d.status, 'verification_state', d.verification_state, 'ssl_state', d.ssl_state, 'last_error', d.last_error, 'updated_at', d.updated_at) order by d.created_at desc) from public.workspace_domains d where d.workspace_id = w.id), '[]'::jsonb),
      'pwa', (select jsonb_build_object('app_name', p.app_name, 'theme_color', p.theme_color, 'background_color', p.background_color, 'updated_at', p.updated_at) from public.workspace_pwa_settings p where p.workspace_id = w.id),
      'audit', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id, 'reason', a.reason, 'created_at', a.created_at) order by a.created_at desc) from public.audit_events a where a.entity_type = 'workspace' and a.entity_id = w.id::text limit 25), '[]'::jsonb)
    ) into result
    from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id where w.id = target_workspace;
  end if;
  if result is null then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'platform.workspace.view', 'workspace', target_workspace::text, jsonb_build_object('mode', 'read_only', 'role', actor_role));
  return result;
end;
$$;

create or replace function public.platform_list_users()
returns table (id uuid, email varchar, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_has_platform_capability('platform.user.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select u.id, u.email, u.created_at, u.last_sign_in_at from auth.users u order by u.created_at desc limit 500;
end;
$$;

create or replace function public.platform_health_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare health jsonb; failed_count bigint; role text := private.current_user_platform_role();
begin
  if not private.current_user_has_platform_capability('platform.health.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select public.core_health_check() into health;
  select count(*) into failed_count from public.billing_webhook_events where status = 'failed' and created_at >= now() - interval '7 days';
  return jsonb_build_object('ok', coalesce((health ->> 'ok')::boolean, false), 'missingTables', coalesce(health -> 'missingTables', '[]'::jsonb), 'missingFunctions', coalesce(health -> 'missingFunctions', '[]'::jsonb), 'rls', coalesce(health -> 'rls', '"unknown"'::jsonb), 'failedWebhooksLast7Days', failed_count, 'migrationVersion', (select max(version) from public.saas_core_schema_versions), 'checkedAt', now(), 'role', role);
end;
$$;

create or replace function public.platform_search(target_query text, target_limit integer default 25)
returns table (result_type text, id uuid, title text, subtitle text, href text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q text := lower(trim(coalesce(target_query, ''))); lim integer := least(greatest(coalesce(target_limit, 25), 1), 50); role text := private.current_user_platform_role();
begin
  if role is null then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if q = '' then return; end if;
  return query
    select r.result_type, r.id, r.title, r.subtitle, r.href
    from (
      select 'workspace'::text as result_type, w.id, w.name as title, w.slug as subtitle, '/platform/workspaces/' || w.id::text as href
        from public.workspaces w where lower(w.name) like '%' || q || '%' or lower(w.slug) like '%' || q || '%'
      union all
      select 'user'::text, u.id, coalesce(u.email, u.id::text), 'User account', '/platform/users'
        from auth.users u where lower(coalesce(u.email, '')) like '%' || q || '%'
      union all
      select 'domain'::text, d.id, d.hostname, w.name, '/platform/domains'
        from public.workspace_domains d join public.workspaces w on w.id = d.workspace_id where lower(d.hostname) like '%' || q || '%'
      union all
      select 'billing'::text, s.workspace_id, w.name, coalesce(s.provider_customer_id, s.provider_subscription_id, s.plan_key), '/platform/billing/' || s.workspace_id::text
        from public.workspace_subscriptions s join public.workspaces w on w.id = s.workspace_id
        where lower(coalesce(s.provider_customer_id, '')) like '%' || q || '%' or lower(coalesce(s.provider_subscription_id, '')) like '%' || q || '%'
    ) r
    where case role
      when 'platform_owner' then true
      when 'platform_admin' then true
      when 'support' then r.result_type in ('workspace', 'user', 'domain', 'billing')
      when 'billing_admin' then r.result_type = 'billing'
      when 'auditor' then r.result_type = 'workspace'
      else false
    end
    limit lim;
end;
$$;

create or replace function public.platform_list_overrides(target_state text default 'active', target_limit integer default 100)
returns table (id uuid, workspace_id uuid, workspace_name text, plan_key text, reason text, effective_from timestamptz, effective_until timestamptz, revoked_at timestamptz, actor_user_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_has_platform_capability('platform.override.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select o.id, o.workspace_id, w.name, o.plan_key, o.reason, o.effective_from, o.effective_until, o.revoked_at, o.actor_user_id
    from public.subscription_overrides o join public.workspaces w on w.id = o.workspace_id
    where case target_state when 'active' then o.revoked_at is null and o.effective_from <= now() and (o.effective_until is null or o.effective_until > now()) when 'expiring' then o.revoked_at is null and o.effective_until > now() and o.effective_until <= now() + interval '7 days' when 'expired' then o.revoked_at is null and o.effective_until is not null and o.effective_until <= now() when 'revoked' then o.revoked_at is not null else true end
    order by coalesce(o.effective_until, 'infinity'::timestamptz), o.created_at desc limit lim;
end;
$$;

create or replace function public.platform_list_subscriptions(target_limit integer default 100)
returns table (workspace_id uuid, workspace_name text, provider text, provider_customer_id text, provider_subscription_id text, plan_key text, status text, billing_interval text, current_period_start timestamptz, current_period_end timestamptz, scheduled_plan_key text, scheduled_plan_at timestamptz, payment_grace_ends_at timestamptz, billing_issue_code text, last_provider_event_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_has_platform_capability('platform.billing.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select s.workspace_id, w.name, s.provider, s.provider_customer_id, s.provider_subscription_id, s.plan_key, s.status, s.billing_interval, s.current_period_start, s.current_period_end, s.scheduled_plan_key, s.scheduled_plan_at, s.payment_grace_ends_at, s.billing_issue_code, s.last_provider_event_at
    from public.workspace_subscriptions s join public.workspaces w on w.id = s.workspace_id order by s.updated_at desc limit lim;
end;
$$;

create or replace function public.platform_list_domains(target_limit integer default 100)
returns table (id uuid, workspace_id uuid, workspace_name text, hostname text, status text, verification_state text, ssl_state text, provider_error text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_has_platform_capability('platform.domain.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select d.id, d.workspace_id, w.name, d.hostname, d.status, d.verification_state, d.ssl_state, d.last_error, d.created_at, d.updated_at
    from public.workspace_domains d join public.workspaces w on w.id = d.workspace_id order by d.updated_at desc limit lim;
end;
$$;

create or replace function public.platform_list_audit(target_workspace uuid default null, target_actor uuid default null, target_action text default null, target_entity_type text default null, target_limit integer default 100, target_offset integer default 0)
returns table (id uuid, actor_user_id uuid, action text, entity_type text, entity_id text, before_data jsonb, after_data jsonb, reason text, metadata jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_has_platform_capability('platform.audit.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id,
    a.before_data - array['token', 'token_hash', 'password', 'secret', 'api_key'],
    a.after_data - array['token', 'token_hash', 'password', 'secret', 'api_key'],
    a.reason, a.metadata - array['token', 'token_hash', 'password', 'secret', 'api_key'], a.created_at
    from public.audit_events a
    where (target_workspace is null or a.entity_id = target_workspace::text or a.metadata ->> 'workspaceId' = target_workspace::text)
      and (target_actor is null or a.actor_user_id = target_actor)
      and (target_action is null or a.action = target_action)
      and (target_entity_type is null or a.entity_type = target_entity_type)
    order by a.created_at desc limit lim offset greatest(coalesce(target_offset, 0), 0);
end;
$$;

create or replace function public.platform_attention_filtered(target_limit integer default 100, target_severity text default null, target_issue_type text default null)
returns table (issue_key text, severity text, workspace_id uuid, workspace_name text, issue_type text, message text, recommended_action text, deep_link text, first_observed timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200); role text := private.current_user_platform_role();
begin
  if role is null then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query
    select issues.issue_key, issues.severity, issues.workspace_id, issues.workspace_name, issues.issue_type, issues.message, issues.recommended_action, issues.deep_link, issues.first_observed
    from (
      select 'past_due:' || s.workspace_id::text as issue_key, case when s.payment_grace_ends_at <= now() then 'error' else 'warning' end as severity, s.workspace_id, w.name as workspace_name, 'payment'::text as issue_type, case when s.payment_grace_ends_at <= now() then 'Payment grace has expired.' else 'Subscription is past due.' end as message, 'Review billing state and reconcile the provider subscription.' as recommended_action, '/platform/billing/' || s.workspace_id::text as deep_link, coalesce(s.payment_failure_started_at, s.updated_at) as first_observed
        from public.workspace_subscriptions s join public.workspaces w on w.id = s.workspace_id where s.status = 'past_due'
      union all
      select 'webhook:' || b.id::text, 'error', b.workspace_id, coalesce(w.name, 'Platform'), 'billing_webhook', left(coalesce(b.error_message, 'Billing webhook failed.'), 240), 'Inspect the failed event and retry or reconcile it.', '/platform/billing', b.created_at
        from public.billing_webhook_events b left join public.workspaces w on w.id = b.workspace_id where b.status = 'failed'
      union all
      select 'override:' || o.id::text, 'warning', o.workspace_id, w.name, 'override', 'A subscription override expires within seven days.', 'Review or revoke the override if it is no longer needed.', '/platform/overrides', o.effective_until
        from public.subscription_overrides o join public.workspaces w on w.id = o.workspace_id where o.revoked_at is null and o.effective_until > now() and o.effective_until <= now() + interval '7 days'
      union all
      select 'domain:' || d.id::text, 'warning', d.workspace_id, w.name, 'domain', 'A custom domain requires verification or provider attention.', 'Recheck domain verification and provider state.', '/platform/domains', d.created_at
        from public.workspace_domains d join public.workspaces w on w.id = d.workspace_id where d.status = 'error' or d.verification_state = 'failed'
    ) issues
    where (target_severity is null or issues.severity = target_severity)
      and (target_issue_type is null or issues.issue_type = target_issue_type)
      and case role when 'platform_owner' then true when 'platform_admin' then true when 'billing_admin' then issues.issue_type in ('payment', 'billing_webhook', 'override') when 'support' then issues.issue_type in ('payment', 'billing_webhook', 'domain') when 'auditor' then issues.issue_type in ('payment', 'billing_webhook', 'domain') else false end
    order by case issues.severity when 'error' then 0 else 1 end, issues.first_observed asc limit lim;
end;
$$;

create or replace function public.platform_attention(target_limit integer default 100)
returns table (issue_key text, severity text, workspace_id uuid, workspace_name text, issue_type text, message text, recommended_action text, deep_link text, first_observed timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.platform_attention_filtered(target_limit, null, null);
$$;

create or replace function public.platform_create_override(target_workspace uuid, target_plan_key text, target_reason text, target_effective_from timestamptz default now(), target_effective_until timestamptz default null, target_operation_id text default null)
returns setof public.subscription_overrides
language plpgsql security definer set search_path = public, pg_temp as $$
declare created public.subscription_overrides; workspace_exists boolean;
begin
  if not private.current_user_has_platform_capability('platform.override.manage') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if length(trim(coalesce(target_reason, ''))) < 3 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  if target_effective_until is not null and target_effective_until <= target_effective_from then raise exception using errcode = '22023', message = 'INVALID_EFFECTIVE_WINDOW'; end if;
  select exists(select 1 from public.workspaces where id = target_workspace) into workspace_exists;
  if not workspace_exists then raise exception using errcode = 'P0002', message = 'WORKSPACE_NOT_FOUND'; end if;
  if not exists(select 1 from public.plans where key = target_plan_key and active) then raise exception using errcode = 'P0002', message = 'PLAN_NOT_FOUND'; end if;
  perform 1 from public.workspace_subscriptions where workspace_id = target_workspace for update;
  insert into public.subscription_overrides(workspace_id, plan_key, reason, actor_user_id, effective_from, effective_until)
    values (target_workspace, target_plan_key, trim(target_reason), auth.uid(), target_effective_from, target_effective_until) returning * into created;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, after_data, reason, metadata)
    values (auth.uid(), 'platform.override.created', 'subscription_override', created.id::text, jsonb_build_object('workspaceId', target_workspace, 'planKey', target_plan_key, 'effectiveFrom', target_effective_from, 'effectiveUntil', target_effective_until), trim(target_reason), jsonb_build_object('operationId', target_operation_id));
  return next created;
end;
$$;

create or replace function public.platform_revoke_override(target_override uuid, target_reason text, target_operation_id text default null)
returns setof public.subscription_overrides
language plpgsql security definer set search_path = public, pg_temp as $$
declare current_row public.subscription_overrides; updated_row public.subscription_overrides;
begin
  if not private.current_user_has_platform_capability('platform.override.manage') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if length(trim(coalesce(target_reason, ''))) < 3 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  select * into current_row from public.subscription_overrides where id = target_override for update;
  if current_row.id is null then raise exception using errcode = 'P0002', message = 'OVERRIDE_NOT_FOUND'; end if;
  if current_row.revoked_at is not null then return next current_row; return; end if;
  update public.subscription_overrides set revoked_at = now() where id = target_override returning * into updated_row;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, before_data, after_data, reason, metadata)
    values (auth.uid(), 'platform.override.revoked', 'subscription_override', target_override::text, jsonb_build_object('planKey', current_row.plan_key, 'revokedAt', current_row.revoked_at), jsonb_build_object('planKey', updated_row.plan_key, 'revokedAt', updated_row.revoked_at), trim(target_reason), jsonb_build_object('operationId', target_operation_id));
  return next updated_row;
end;
$$;

create or replace function public.platform_get_domain(target_domain uuid)
returns setof public.workspace_domains
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_has_platform_capability('platform.domain.manage') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select d from public.workspace_domains d where d.id = target_domain;
end;
$$;

create or replace function public.platform_apply_domain_reconciliation(target_domain uuid, target_provider_domain_id text, target_status text, target_verification_state text, target_dns_configured boolean, target_ssl_state text, target_last_error text, target_operation_id text default null)
returns setof public.workspace_domains
language plpgsql security definer set search_path = public, pg_temp as $$
declare before_row public.workspace_domains; after_row public.workspace_domains;
begin
  if not private.current_user_has_platform_capability('platform.domain.manage') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if target_status not in ('pending', 'verified', 'active', 'error', 'suspended') or target_verification_state not in ('pending', 'verified', 'failed') or target_ssl_state not in ('pending', 'provisioned', 'failed') then raise exception using errcode = '22023', message = 'INVALID_DOMAIN_STATE'; end if;
  select * into before_row from public.workspace_domains where id = target_domain for update;
  if before_row.id is null then raise exception using errcode = 'P0002', message = 'DOMAIN_NOT_FOUND'; end if;
  update public.workspace_domains set provider_domain_id = target_provider_domain_id, status = target_status, verification_state = target_verification_state, dns_configured = target_dns_configured, ssl_state = target_ssl_state, last_error = left(target_last_error, 2000), last_checked_at = now(), updated_at = now() where id = target_domain returning * into after_row;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
    values (auth.uid(), 'platform.domain.reconciled', 'domain', target_domain::text, jsonb_build_object('status', before_row.status, 'verificationState', before_row.verification_state, 'sslState', before_row.ssl_state), jsonb_build_object('status', after_row.status, 'verificationState', after_row.verification_state, 'sslState', after_row.ssl_state), jsonb_build_object('operationId', target_operation_id));
  return next after_row;
end;
$$;

create or replace function public.platform_get_subscription(target_workspace uuid)
returns setof public.workspace_subscriptions
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not private.current_user_has_platform_capability('platform.billing.read') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select s from public.workspace_subscriptions s where s.workspace_id = target_workspace;
end;
$$;

create or replace function public.platform_apply_subscription_reconciliation(target_workspace uuid, target_plan_key text, target_status text, target_provider_customer_id text, target_provider_subscription_id text, target_provider_price_id text, target_billing_interval text, target_billing_currency text, target_period_start timestamptz, target_period_end timestamptz, target_scheduled_plan_key text, target_scheduled_plan_at timestamptz, target_event_at timestamptz, target_operation_id text default null)
returns setof public.workspace_subscriptions
language plpgsql security definer set search_path = public, pg_temp as $$
declare before_row public.workspace_subscriptions; after_row public.workspace_subscriptions;
begin
  if not private.current_user_has_platform_capability('platform.billing.manage') then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if target_status not in ('active', 'trialing', 'past_due', 'paused', 'canceled') or target_billing_interval not in ('month', 'year') then raise exception using errcode = '22023', message = 'INVALID_SUBSCRIPTION_STATE'; end if;
  if not exists(select 1 from public.plans where key = target_plan_key) then raise exception using errcode = 'P0002', message = 'PLAN_NOT_FOUND'; end if;
  select * into before_row from public.workspace_subscriptions where workspace_id = target_workspace for update;
  if before_row.workspace_id is null then raise exception using errcode = 'P0002', message = 'SUBSCRIPTION_NOT_FOUND'; end if;
  if before_row.last_provider_event_at is not null and target_event_at <= before_row.last_provider_event_at then return next before_row; return; end if;
  update public.workspace_subscriptions set plan_key = target_plan_key, status = target_status, source = 'paddle', provider = 'paddle', provider_customer_id = target_provider_customer_id, provider_subscription_id = target_provider_subscription_id, provider_price_id = target_provider_price_id, billing_interval = target_billing_interval, billing_currency = target_billing_currency, current_period_start = target_period_start, current_period_end = target_period_end, scheduled_plan_key = target_scheduled_plan_key, scheduled_plan_at = target_scheduled_plan_at, last_provider_event_at = target_event_at, last_provider_event_id = 'reconcile:' || coalesce(target_operation_id, target_event_at::text), billing_issue_code = case when target_status = 'past_due' then 'past_due' else null end, updated_at = now() where workspace_id = target_workspace returning * into after_row;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
    values (auth.uid(), 'platform.billing.reconciled', 'subscription', target_workspace::text, jsonb_build_object('planKey', before_row.plan_key, 'status', before_row.status, 'providerSubscriptionId', before_row.provider_subscription_id), jsonb_build_object('planKey', after_row.plan_key, 'status', after_row.status, 'providerSubscriptionId', after_row.provider_subscription_id), jsonb_build_object('operationId', target_operation_id));
  return next after_row;
end;
$$;

revoke all on function public.platform_list_workspaces() from public, anon;
revoke all on function public.platform_support_view(uuid) from public, anon;
revoke all on function public.platform_workspace_360(uuid) from public, anon;
revoke all on function public.platform_list_users() from public, anon;
revoke all on function public.platform_health_snapshot() from public, anon;
revoke all on function public.platform_search(text, integer) from public, anon;
revoke all on function public.platform_list_overrides(text, integer) from public, anon;
revoke all on function public.platform_list_subscriptions(integer) from public, anon;
revoke all on function public.platform_list_domains(integer) from public, anon;
revoke all on function public.platform_list_audit(uuid, uuid, text, text, integer, integer) from public, anon;
revoke all on function public.platform_attention(integer) from public, anon;
revoke all on function public.platform_attention_filtered(integer, text, text) from public, anon;
revoke all on function public.platform_create_override(uuid, text, text, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.platform_revoke_override(uuid, text, text) from public, anon;
revoke all on function public.platform_get_domain(uuid) from public, anon;
revoke all on function public.platform_apply_domain_reconciliation(uuid, text, text, text, boolean, text, text, text) from public, anon;
revoke all on function public.platform_get_subscription(uuid) from public, anon;
revoke all on function public.platform_apply_subscription_reconciliation(uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.platform_list_workspaces() to authenticated;
grant execute on function public.platform_support_view(uuid) to authenticated;
grant execute on function public.platform_workspace_360(uuid) to authenticated;
grant execute on function public.platform_list_users() to authenticated;
grant execute on function public.platform_health_snapshot() to authenticated;
grant execute on function public.platform_search(text, integer) to authenticated;
grant execute on function public.platform_list_overrides(text, integer) to authenticated;
grant execute on function public.platform_list_subscriptions(integer) to authenticated;
grant execute on function public.platform_list_domains(integer) to authenticated;
grant execute on function public.platform_list_audit(uuid, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.platform_attention(integer) to authenticated;
grant execute on function public.platform_attention_filtered(integer, text, text) to authenticated;
grant execute on function public.platform_create_override(uuid, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.platform_revoke_override(uuid, text, text) to authenticated;
grant execute on function public.platform_get_domain(uuid) to authenticated;
grant execute on function public.platform_apply_domain_reconciliation(uuid, text, text, text, boolean, text, text, text) to authenticated;
grant execute on function public.platform_get_subscription(uuid) to authenticated;
grant execute on function public.platform_apply_subscription_reconciliation(uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, text, timestamptz, timestamptz, text) to authenticated;

insert into public.saas_core_schema_versions(version, package_version)
values ('1.3.1', '1.1.1') on conflict (version) do update set package_version = excluded.package_version;
