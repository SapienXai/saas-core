-- Local-only Core fixture. It contains no product-domain records.

insert into public.workspaces (id, name, slug, status)
values ('00000000-0000-4000-8000-000000000010', 'Example Workspace', 'example-workspace', 'active')
on conflict (id) do nothing;

insert into public.workspace_subscriptions (workspace_id, plan_key, status, source, current_period_start, current_period_end)
values ('00000000-0000-4000-8000-000000000010', 'free', 'active', 'free', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month')::date)
on conflict (workspace_id) do update set plan_key = excluded.plan_key, status = excluded.status, source = excluded.source, current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, updated_at = now();
