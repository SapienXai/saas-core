-- Phase 10A: anonymous public reservation abuse controls.
-- The key is a server-side hash of restaurant + short-lived client identity.
-- Raw network identifiers are never stored.

alter table public.reservations
  add column if not exists public_submission_id text;

alter table public.reservations
  drop constraint if exists reservations_public_submission_id_check;

alter table public.reservations
  add constraint reservations_public_submission_id_check
  check (public_submission_id is null or public_submission_id ~ '^[A-Za-z0-9_-]{16,100}$');

create unique index if not exists reservations_public_submission_key
  on public.reservations (restaurant_id, public_submission_id)
  where public_submission_id is not null;

create table if not exists public.public_reservation_rate_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 1 check (attempt_count > 0),
  updated_at timestamptz not null default now()
);

create index if not exists public_reservation_rate_limits_updated_idx
  on public.public_reservation_rate_limits (updated_at);

alter table public.public_reservation_rate_limits enable row level security;
revoke all on table public.public_reservation_rate_limits from anon, authenticated;

create or replace function public.consume_public_reservation_rate_limit(
  p_key_hash text,
  p_window_seconds integer default 60,
  p_max_attempts integer default 10
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_count integer;
  now_value timestamptz := clock_timestamp();
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid reservation rate-limit key';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 3600 or p_max_attempts < 1 or p_max_attempts > 100 then
    raise exception 'invalid reservation rate-limit configuration';
  end if;

  insert into public.public_reservation_rate_limits (key_hash, window_started_at, attempt_count, updated_at)
  values (p_key_hash, now_value, 1, now_value)
  on conflict (key_hash) do update
  set
    window_started_at = case
      when public.public_reservation_rate_limits.window_started_at <= now_value - make_interval(secs => p_window_seconds)
        then now_value
      else public.public_reservation_rate_limits.window_started_at
    end,
    attempt_count = case
      when public.public_reservation_rate_limits.window_started_at <= now_value - make_interval(secs => p_window_seconds)
        then 1
      else public.public_reservation_rate_limits.attempt_count + 1
    end,
    updated_at = now_value
  returning attempt_count into current_count;

  if random() < 0.01 then
    delete from public.public_reservation_rate_limits
    where updated_at < now_value - interval '1 day';
  end if;

  return current_count <= p_max_attempts;
end;
$$;

revoke all on function public.consume_public_reservation_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_reservation_rate_limit(text, integer, integer) to service_role;

comment on table public.public_reservation_rate_limits is 'Short-lived hashed counters for public reservation abuse protection; raw client identifiers are never stored.';
comment on column public.reservations.public_submission_id is 'Optional client-generated idempotency key for public reservation retries, scoped to a restaurant.';
