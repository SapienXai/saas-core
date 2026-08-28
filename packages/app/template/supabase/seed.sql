-- Local-only Core fixture. It contains no product-domain records.

insert into public.plans (key, name, sort_order, features, limits, metadata)
values (
  'default',
  'Default',
  0,
  '{}'::jsonb,
  '{"core.workspaces":1,"core.members":null}'::jsonb,
  '{"development":true}'::jsonb
)
on conflict (key) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  features = excluded.features,
  limits = excluded.limits,
  metadata = excluded.metadata,
  active = true,
  updated_at = now();

insert into private.core_settings (singleton, default_plan_key)
values (true, 'default')
on conflict (singleton) do update set default_plan_key = excluded.default_plan_key, updated_at = now();

insert into public.workspaces (id, name, slug, status)
values ('00000000-0000-4000-8000-000000000010', 'Example Workspace', 'example-workspace', 'active')
on conflict (id) do nothing;

insert into public.workspace_subscriptions (workspace_id, plan_key, status, source, current_period_start, current_period_end)
values ('00000000-0000-4000-8000-000000000010', 'default', 'active', 'system', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month')::date)
on conflict (workspace_id) do update set plan_key = excluded.plan_key, status = excluded.status, source = excluded.source, current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, updated_at = now();
