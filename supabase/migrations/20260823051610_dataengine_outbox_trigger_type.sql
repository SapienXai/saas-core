-- Preserve the immutable 20260822130000 migration while repairing databases
-- where that migration created the legacy `trigger` column before its file was
-- corrected to `trigger_type`.
do $$
declare
  has_trigger boolean;
  has_trigger_type boolean;
begin
  if to_regclass('public.email_outbox_runs') is null then
    create table public.email_outbox_runs (
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

    create index email_outbox_runs_started_idx
      on public.email_outbox_runs (started_at desc);

    alter table public.email_outbox_runs enable row level security;
    revoke all on public.email_outbox_runs from public, anon, authenticated;
    grant all on public.email_outbox_runs to service_role;
    comment on table public.email_outbox_runs is 'Private cron/manual invocation health for the durable transactional email outbox.';
    perform pg_notify('pgrst', 'reload schema');
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_outbox_runs'
      and column_name = 'trigger'
  ) into has_trigger;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_outbox_runs'
      and column_name = 'trigger_type'
  ) into has_trigger_type;

  if has_trigger and has_trigger_type then
    raise exception using
      errcode = 'duplicate_column',
      message = 'email_outbox_runs contains both legacy "trigger" and canonical "trigger_type"; refusing to choose a column or discard data';
  elsif has_trigger then
    alter table public.email_outbox_runs rename column "trigger" to trigger_type;
    perform pg_notify('pgrst', 'reload schema');
  elsif has_trigger_type then
    null;
  else
    raise exception using
      errcode = 'undefined_column',
      message = 'email_outbox_runs exists without either "trigger" or "trigger_type"; refusing to continue';
  end if;
end
$$;
