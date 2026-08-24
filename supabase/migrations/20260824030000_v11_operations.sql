-- SaaS Core v1.1 operational platform queries. Ownership: core.

create or replace function public.platform_search(target_query text, target_limit integer default 25)
returns table (result_type text, id uuid, title text, subtitle text, href text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q text := lower(trim(coalesce(target_query, ''))); lim integer := least(greatest(coalesce(target_limit, 25), 1), 50);
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','billing_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if q = '' then return; end if;
  return query
    select r.result_type, r.id, r.title, r.subtitle, r.href
    from (
      select 'workspace'::text, w.id, w.name, w.slug, '/platform/workspaces/' || w.id::text
      from public.workspaces w
      where lower(w.name) like '%' || q || '%' or lower(w.slug) like '%' || q || '%'
      union all
      select 'user'::text, u.id, coalesce(u.email, u.id::text), 'User account', '/platform/users'
      from auth.users u
      where lower(coalesce(u.email, '')) like '%' || q || '%'
      union all
      select 'domain'::text, d.id, d.hostname, w.name, '/platform/domains'
      from public.workspace_domains d join public.workspaces w on w.id = d.workspace_id
      where lower(d.hostname) like '%' || q || '%'
      union all
      select 'billing'::text, s.workspace_id, w.name, coalesce(s.provider_customer_id, s.provider_subscription_id, s.plan_key), '/platform/billing/' || s.workspace_id::text
      from public.workspace_subscriptions s join public.workspaces w on w.id = s.workspace_id
      where lower(coalesce(s.provider_customer_id, '')) like '%' || q || '%'
         or lower(coalesce(s.provider_subscription_id, '')) like '%' || q || '%'
    ) as r(result_type, id, title, subtitle, href)
    limit lim;
end;
$$;

create or replace function public.platform_list_overrides(target_state text default 'active', target_limit integer default 100)
returns table (id uuid, workspace_id uuid, workspace_name text, plan_key text, reason text, effective_from timestamptz, effective_until timestamptz, revoked_at timestamptz, actor_user_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','billing_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query
    select o.id, o.workspace_id, w.name, o.plan_key, o.reason, o.effective_from, o.effective_until, o.revoked_at, o.actor_user_id
    from public.subscription_overrides o join public.workspaces w on w.id = o.workspace_id
    where case target_state
      when 'active' then o.revoked_at is null and o.effective_from <= now() and (o.effective_until is null or o.effective_until > now())
      when 'expiring' then o.revoked_at is null and o.effective_until > now() and o.effective_until <= now() + interval '7 days'
      when 'expired' then o.revoked_at is null and o.effective_until is not null and o.effective_until <= now()
      when 'revoked' then o.revoked_at is not null
      else true
    end
    order by coalesce(o.effective_until, 'infinity'::timestamptz), o.created_at desc
    limit lim;
end;
$$;

create or replace function public.platform_list_subscriptions(target_limit integer default 100)
returns table (workspace_id uuid, workspace_name text, provider text, provider_customer_id text, provider_subscription_id text, plan_key text, status text, billing_interval text, current_period_start timestamptz, current_period_end timestamptz, scheduled_plan_key text, scheduled_plan_at timestamptz, payment_grace_ends_at timestamptz, billing_issue_code text, last_provider_event_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','billing_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select s.workspace_id, w.name, s.provider, s.provider_customer_id, s.provider_subscription_id, s.plan_key, s.status, s.billing_interval, s.current_period_start, s.current_period_end, s.scheduled_plan_key, s.scheduled_plan_at, s.payment_grace_ends_at, s.billing_issue_code, s.last_provider_event_at
    from public.workspace_subscriptions s join public.workspaces w on w.id = s.workspace_id order by s.updated_at desc limit lim;
end;
$$;

create or replace function public.platform_list_domains(target_limit integer default 100)
returns table (id uuid, workspace_id uuid, workspace_name text, hostname text, status text, verification_state text, ssl_state text, provider_error text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','billing_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select d.id, d.workspace_id, w.name, d.hostname, d.status, d.verification_state, d.ssl_state, d.provider_error, d.created_at, d.updated_at
    from public.workspace_domains d join public.workspaces w on w.id = d.workspace_id
    order by d.updated_at desc limit lim;
end;
$$;

create or replace function public.platform_list_audit(target_workspace uuid default null, target_actor uuid default null, target_action text default null, target_entity_type text default null, target_limit integer default 100, target_offset integer default 0)
returns table (id uuid, actor_user_id uuid, action text, entity_type text, entity_id text, before_data jsonb, after_data jsonb, reason text, metadata jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query select a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id, a.before_data, a.after_data, a.reason, a.metadata, a.created_at
    from public.audit_events a
    where (target_workspace is null or a.entity_id = target_workspace::text)
      and (target_actor is null or a.actor_user_id = target_actor)
      and (target_action is null or a.action = target_action)
      and (target_entity_type is null or a.entity_type = target_entity_type)
    order by a.created_at desc limit lim offset greatest(target_offset, 0);
end;
$$;

create or replace function public.platform_attention(target_limit integer default 100)
returns table (issue_key text, severity text, workspace_id uuid, workspace_name text, issue_type text, message text, recommended_action text, deep_link text, first_observed timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare lim integer := least(greatest(coalesce(target_limit, 100), 1), 200);
begin
  if not private.current_user_is_platform_member(array['platform_owner','platform_admin','billing_admin','support','auditor']) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return query
    select * from (
      select 'past_due:' || s.workspace_id::text, case when s.payment_grace_ends_at <= now() then 'error' else 'warning' end, s.workspace_id, w.name, 'payment', case when s.payment_grace_ends_at <= now() then 'Payment grace has expired.' else 'Subscription is past due.' end, 'Review billing state and reconcile the provider subscription.', '/platform/billing/' || s.workspace_id::text, coalesce(s.payment_failure_started_at, s.updated_at)
      from public.workspace_subscriptions s join public.workspaces w on w.id = s.workspace_id
      where s.status = 'past_due'
      union all
      select 'webhook:' || b.id::text, 'error', b.workspace_id, coalesce(w.name, 'Platform'), 'billing_webhook', left(coalesce(b.error_message, 'Billing webhook failed.'), 240), 'Inspect the failed event and retry or reconcile it.', '/platform/billing', b.created_at
      from public.billing_webhook_events b left join public.workspaces w on w.id = b.workspace_id
      where b.status = 'failed'
      union all
      select 'override:' || o.id::text, 'warning', o.workspace_id, w.name, 'override', 'A subscription override expires within seven days.', 'Review or revoke the override if it is no longer needed.', '/platform/overrides', o.effective_until
      from public.subscription_overrides o join public.workspaces w on w.id = o.workspace_id
      where o.revoked_at is null and o.effective_until > now() and o.effective_until <= now() + interval '7 days'
      union all
      select 'domain:' || d.id::text, 'warning', d.workspace_id, w.name, 'domain', 'A custom domain requires verification or provider attention.', 'Recheck domain verification and provider state.', '/platform/domains', d.created_at
      from public.workspace_domains d join public.workspaces w on w.id = d.workspace_id
      where d.status = 'error' or d.verification_state = 'failed'
    ) issues order by case severity when 'error' then 0 else 1 end, first_observed asc limit lim;
end;
$$;

revoke all on function public.platform_search(text, integer) from public, anon;
revoke all on function public.platform_list_overrides(text, integer) from public, anon;
revoke all on function public.platform_list_subscriptions(integer) from public, anon;
revoke all on function public.platform_list_domains(integer) from public, anon;
revoke all on function public.platform_list_audit(uuid, uuid, text, text, integer, integer) from public, anon;
revoke all on function public.platform_attention(integer) from public, anon;
grant execute on function public.platform_search(text, integer) to authenticated;
grant execute on function public.platform_list_overrides(text, integer) to authenticated;
grant execute on function public.platform_list_subscriptions(integer) to authenticated;
grant execute on function public.platform_list_domains(integer) to authenticated;
grant execute on function public.platform_list_audit(uuid, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.platform_attention(integer) to authenticated;

insert into public.saas_core_schema_versions(version, package_version) values ('1.3.0', '1.1.0') on conflict (version) do update set package_version = excluded.package_version;
