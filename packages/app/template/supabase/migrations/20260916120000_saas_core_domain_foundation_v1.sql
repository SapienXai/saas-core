-- SaaS Core Domain Foundation v1
--
-- public_sites is the smallest reusable public-surface abstraction. Domains
-- remain in workspace_domains for compatibility with the existing provider
-- reconciliation workflow, but now resolve through a site and carry their own
-- canonical hostname fields.

create table if not exists public.public_sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_key text not null check (product_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, product_key),
  unique (id, workspace_id)
);

create index if not exists public_sites_workspace_idx on public.public_sites (workspace_id, created_at);

create trigger public_sites_set_updated_at
before update on public.public_sites
for each row execute function public.set_updated_at();

alter table public.workspace_domains add column if not exists site_id uuid;
alter table public.workspace_domains add column if not exists normalized_hostname text;
alter table public.workspace_domains add column if not exists type text not null default 'custom';
alter table public.workspace_domains add column if not exists is_primary boolean not null default false;
alter table public.workspace_domains add column if not exists verification_token text;
alter table public.workspace_domains add column if not exists verification_metadata jsonb not null default '{}'::jsonb;

alter table public.workspace_domains drop constraint if exists workspace_domains_status_check;
alter table public.workspace_domains
  add constraint workspace_domains_status_check
  check (status in ('pending', 'verifying', 'active', 'failed', 'error', 'removing', 'removed'));

alter table public.workspace_domains drop constraint if exists workspace_domains_type_check;
alter table public.workspace_domains
  add constraint workspace_domains_type_check
  check (type in ('platform_subdomain', 'custom'));

alter table public.workspace_domains drop constraint if exists workspace_domains_verification_metadata_check;
alter table public.workspace_domains
  add constraint workspace_domains_verification_metadata_check
  check (jsonb_typeof(verification_metadata) = 'object');

-- Existing workspace-only mappings are retained and attached to a neutral
-- compatibility surface. The migration must not guess which product renders
-- an old row; new product integrations provide their explicit product_key.
insert into public.public_sites (workspace_id, product_key)
select distinct domain.workspace_id, 'legacy'
from public.workspace_domains as domain
on conflict (workspace_id, product_key) do nothing;

update public.workspace_domains as domain
set site_id = site.id
from public.public_sites as site
where site.workspace_id = domain.workspace_id
  and site.product_key = 'legacy'
  and domain.site_id is null;

-- The existing application already normalized persisted customer hostnames.
-- Keep the original column for compatibility while making the compared value
-- explicit and stable for all old rows.
update public.workspace_domains
set normalized_hostname = trim(trailing '.' from lower(btrim(hostname)))
where normalized_hostname is null;

-- Preserve an existing primary when one exists; otherwise choose the oldest
-- mapping deterministically. This also makes the migration safe if a partially
-- upgraded database already contains more than one legacy mapping.
with ranked as (
  select id,
         row_number() over (
           partition by site_id
           order by is_primary desc, created_at asc, id asc
         ) as position
  from public.workspace_domains
)
update public.workspace_domains as domain
set is_primary = ranked.position = 1
from ranked
where ranked.id = domain.id;

alter table public.workspace_domains alter column site_id set not null;
alter table public.workspace_domains alter column normalized_hostname set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspace_domains_site_workspace_id_fkey'
      and conrelid = 'public.workspace_domains'::regclass
  ) then
    alter table public.workspace_domains
      add constraint workspace_domains_site_workspace_id_fkey
      foreign key (site_id, workspace_id)
      references public.public_sites (id, workspace_id)
      on delete cascade;
  end if;
end;
$$;

-- The old one-domain-per-workspace constraint is incompatible with a public
-- site owning multiple domains. Hostnames remain globally unique below.
alter table public.workspace_domains drop constraint if exists workspace_domains_workspace_id_key;

create index if not exists workspace_domains_site_idx
  on public.workspace_domains (site_id, created_at desc);
create unique index if not exists workspace_domains_normalized_hostname_key
  on public.workspace_domains (normalized_hostname);
create unique index if not exists workspace_domains_one_platform_per_site_key
  on public.workspace_domains (site_id)
  where type = 'platform_subdomain';
create unique index if not exists workspace_domains_one_primary_per_site_key
  on public.workspace_domains (site_id)
  where is_primary;

alter table public.public_sites enable row level security;

drop policy if exists public_sites_read on public.public_sites;
create policy public_sites_read
  on public.public_sites for select to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists public_sites_manage on public.public_sites;
-- Public-surface and domain mutations stay behind the Core service so
-- normalization, reserved names, primary selection, and claim races cannot be
-- bypassed by a direct authenticated table write.
revoke insert, update, delete on public.public_sites from authenticated;
revoke insert, update, delete on public.workspace_domains from authenticated;
drop policy if exists domains_manage on public.workspace_domains;

grant select on public.public_sites to authenticated;
grant all on public.public_sites to service_role;

comment on table public.public_sites is 'A workspace-owned public surface; product_key selects the rendering/application context.';
comment on table public.workspace_domains is 'Canonical Core hostname mappings. Ownership is the workspace; domains resolve through public_sites.';
comment on column public.workspace_domains.site_id is 'The workspace-owned public surface rendered for this domain.';
comment on column public.workspace_domains.normalized_hostname is 'Canonical lower-case, port-free, trailing-dot-free hostname used for global lookup.';
comment on column public.workspace_domains.type is 'Domain kind: platform_subdomain or custom.';

create or replace function public.claim_platform_subdomain(
  target_workspace_id uuid,
  target_site_id uuid,
  target_hostname text,
  target_replace_existing boolean default false
)
returns table (
  domain_id uuid,
  site_id uuid,
  workspace_id uuid,
  hostname text,
  normalized_hostname text,
  domain_type text,
  status text,
  is_primary boolean,
  verification_token text,
  verification_metadata jsonb,
  verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_domain public.workspace_domains%rowtype;
  conflicting_domain public.workspace_domains%rowtype;
  target_site public.public_sites%rowtype;
  normalized text;
begin
  normalized := trim(trailing '.' from lower(btrim(coalesce(target_hostname, ''))));
  if normalized = ''
    or target_hostname <> normalized
    or length(normalized) > 253
    or normalized !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception using message = 'DOMAIN_HOSTNAME_INVALID';
  end if;

  -- All callers of this server-only function serialize claims for the same
  -- hostname. The unique index remains the final authority for direct races.
  perform pg_advisory_xact_lock(hashtextextended(normalized, 0));

  select site.* into target_site
  from public.public_sites as site
  where site.id = target_site_id and site.workspace_id = target_workspace_id
  for update;
  if target_site.id is null then
    raise exception using message = 'PUBLIC_SITE_NOT_FOUND';
  end if;

  select domain.* into target_domain
  from public.workspace_domains as domain
  where domain.site_id = target_site_id and domain.type = 'platform_subdomain'
  order by domain.created_at asc, domain.id asc
  limit 1
  for update;

  if target_domain.id is not null and target_domain.normalized_hostname <> normalized and not target_replace_existing then
    raise exception using message = 'PLATFORM_DOMAIN_EXISTS';
  end if;
  if target_domain.id is null and target_replace_existing then
    raise exception using message = 'PLATFORM_DOMAIN_NOT_FOUND';
  end if;

  select domain.* into conflicting_domain
  from public.workspace_domains as domain
  where domain.normalized_hostname = normalized
    and (target_domain.id is null or domain.id <> target_domain.id)
  for update;
  if conflicting_domain.id is not null then
    raise exception using message = 'DOMAIN_HOSTNAME_CONFLICT';
  end if;

  begin
    if target_domain.id is null then
      insert into public.workspace_domains (
        workspace_id,
        site_id,
        hostname,
        normalized_hostname,
        type,
        status,
        is_primary,
        provider,
        provider_environment,
        verification_state,
        provider_verified,
        dns_configured,
        verification_metadata,
        verified_at,
        last_checked_at
      )
      values (
        target_workspace_id,
        target_site_id,
        normalized,
        normalized,
        'platform_subdomain',
        'active',
        false,
        'saas_core',
        'production',
        'verified',
        true,
        true,
        jsonb_build_object('managed_by', 'saas_core', 'kind', 'platform_subdomain'),
        now(),
        now()
      )
      returning * into target_domain;
    else
      update public.workspace_domains
      set hostname = normalized,
          normalized_hostname = normalized,
          type = 'platform_subdomain',
          status = 'active',
          is_primary = false,
          provider = 'saas_core',
          provider_environment = 'production',
          verification_state = 'verified',
          provider_verified = true,
          dns_configured = true,
          verification_token = null,
          verification_metadata = jsonb_build_object('managed_by', 'saas_core', 'kind', 'platform_subdomain'),
          verified_at = coalesce(target_domain.verified_at, now()),
          last_checked_at = now(),
          last_error_code = null,
          last_error_message = null
      where id = target_domain.id
      returning * into target_domain;
    end if;
  exception when unique_violation then
    raise exception using message = 'DOMAIN_HOSTNAME_CONFLICT';
  end;

  update public.workspace_domains as domain
  set is_primary = false
  where domain.site_id = target_site_id and domain.is_primary and domain.id <> target_domain.id;

  update public.workspace_domains
  set is_primary = true
  where id = target_domain.id;

  return query
  select domain.id,
         domain.site_id,
         domain.workspace_id,
         domain.hostname,
         domain.normalized_hostname,
         domain.type,
         domain.status,
         domain.is_primary,
         domain.verification_token,
         domain.verification_metadata,
         domain.verified_at,
         domain.created_at,
         domain.updated_at
  from public.workspace_domains as domain
  where domain.id = target_domain.id;
end;
$$;

create or replace function public.resolve_domain_host(target_normalized_hostname text)
returns table (
  domain_id uuid,
  site_id uuid,
  workspace_id uuid,
  product_key text,
  hostname text,
  normalized_hostname text,
  domain_type text,
  is_primary boolean,
  workspace_slug text,
  workspace_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select domain.id,
         domain.site_id,
         domain.workspace_id,
         site.product_key,
         domain.hostname,
         domain.normalized_hostname,
         domain.type,
         domain.is_primary,
         workspace.slug,
         workspace.name
  from public.workspace_domains as domain
  join public.public_sites as site
    on site.id = domain.site_id
   and site.workspace_id = domain.workspace_id
  join public.workspaces as workspace
    on workspace.id = domain.workspace_id
  where domain.normalized_hostname = target_normalized_hostname
    and domain.status = 'active'
    and workspace.status = 'active'
    and workspace.platform_status = 'active'
    and (
      domain.type = 'platform_subdomain'
      or (
        domain.type = 'custom'
        and domain.provider_environment = 'production'
        and domain.verification_state = 'verified'
        and domain.provider_verified = true
        and domain.dns_configured = true
        and domain.verified_at is not null
      )
    );
$$;

revoke all on function public.claim_platform_subdomain(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_platform_subdomain(uuid, uuid, text, boolean) to service_role;
revoke all on function public.resolve_domain_host(text) from public, anon, authenticated;
grant execute on function public.resolve_domain_host(text) to service_role;
