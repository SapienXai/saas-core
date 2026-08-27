-- Platform Control search directory.
-- This is a server-controlled projection of safe identity fields from auth.users.
-- It avoids loading the entire Auth user collection for every platform request.

create table if not exists public.platform_user_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_user_directory_email_idx
  on public.platform_user_directory (lower(email));
create index if not exists platform_user_directory_name_idx
  on public.platform_user_directory (lower(full_name));
create index if not exists platform_user_directory_activity_idx
  on public.platform_user_directory (last_sign_in_at desc, created_at desc);

create or replace function private.sync_platform_user_directory()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.platform_user_directory (user_id, email, full_name, last_sign_in_at, created_at, updated_at)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    new.last_sign_in_at,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (user_id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    last_sign_in_at = excluded.last_sign_in_at,
    updated_at = now();
  return new;
end;
$$;

revoke all on function private.sync_platform_user_directory() from public, anon, authenticated;

insert into public.platform_user_directory (user_id, email, full_name, last_sign_in_at, created_at, updated_at)
select
  id,
  coalesce(email, ''),
  nullif(btrim(coalesce(raw_user_meta_data ->> 'full_name', '')), ''),
  last_sign_in_at,
  coalesce(created_at, now()),
  now()
from auth.users
on conflict (user_id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  last_sign_in_at = excluded.last_sign_in_at,
  updated_at = now();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'platform_user_directory_after_auth_user_change') then
    create trigger platform_user_directory_after_auth_user_change
      after insert or update of email, raw_user_meta_data, last_sign_in_at on auth.users
      for each row execute function private.sync_platform_user_directory();
  end if;
end $$;

alter table public.platform_user_directory enable row level security;
revoke all on public.platform_user_directory from anon, authenticated;
grant all on public.platform_user_directory to service_role;

comment on table public.platform_user_directory is 'Server-controlled safe identity projection used by Platform Control search and bounded admin lists.';
