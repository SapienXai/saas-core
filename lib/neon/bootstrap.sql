-- Run before the shared Core migrations on a new Neon database only.
do $$
begin
  if to_regrole('anon') is null then create role anon nologin; end if;
  if to_regrole('authenticated') is null then create role authenticated nologin; end if;
  if to_regrole('service_role') is null then create role service_role nologin; end if;
end;
$$;

create schema auth;
revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable set search_path = pg_catalog
as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
create function auth.uid() returns uuid language sql stable set search_path = pg_catalog
as $$ select case when auth.jwt() ->> 'role' = 'authenticated' then (auth.jwt() ->> 'sub')::uuid end $$;
create function auth.role() returns text language sql stable set search_path = pg_catalog
as $$ select auth.jwt() ->> 'role' $$;

-- Better Auth shares the UUID referenced by Core's existing foreign keys.
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  "emailVerified" boolean not null,
  image text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  created_at timestamptz generated always as ("createdAt") stored,
  role text, banned boolean, "banReason" text, "banExpires" timestamptz
);
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "ipAddress" text, "userAgent" text, "impersonatedBy" text,
  "userId" uuid not null references auth.users(id) on delete cascade
);
create index core_auth_sessions_user on auth.sessions ("userId");
create table auth.accounts (
  id uuid primary key default gen_random_uuid(),
  "accountId" text not null, "providerId" text not null,
  "userId" uuid not null references auth.users(id) on delete cascade,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
  unique ("providerId", "accountId")
);
create index core_auth_accounts_user on auth.accounts ("userId");
create table auth.verifications (
  id uuid primary key default gen_random_uuid(),
  identifier text not null, value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create index core_auth_verification_identifier on auth.verifications (identifier);
create table auth.rate_limits (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, count integer not null, "lastRequest" bigint not null
);
create table auth.workspace_assets (
  path text primary key,
  bytes bytea not null check (octet_length(bytes) between 1 and 2097152),
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp','image/gif','image/avif'))
);

-- Compatibility metadata for immutable Core migrations. Asset bytes live in auth.workspace_assets.
create schema storage;
revoke all on schema storage from public;
create table storage.buckets (id text primary key, name text not null, public boolean not null);
create table storage.objects (bucket_id text not null references storage.buckets(id), name text not null);
alter table storage.objects enable row level security;
