-- Durable invocation-level observability for the transactional email outbox.
-- This table is intentionally service-role only; Platform Control reads an
-- aggregate through the server and never exposes recipient or payload data.
create table if not exists public.email_outbox_runs (
  id uuid primary key default gen_random_uuid(),
  invocation_id text not null unique,
  trigger text not null default 'cron' check (trigger in ('cron', 'manual')),
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

create index if not exists email_outbox_runs_started_idx
  on public.email_outbox_runs (started_at desc);

alter table public.email_outbox_runs enable row level security;
revoke all on public.email_outbox_runs from public, anon, authenticated;
grant all on public.email_outbox_runs to service_role;

comment on table public.email_outbox_runs is 'Private cron/manual invocation health for the durable transactional email outbox.';

notify pgrst, 'reload schema';
