-- Reservevia Phase 6: customer-owned custom domain mappings.
-- Hosted Reservevia subdomains continue to derive from restaurants.slug and
-- never receive rows in this table.

create table if not exists public.restaurant_domains (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  hostname text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verifying', 'active', 'error', 'removing', 'suspended', 'removed')),
  provider text not null default 'vercel'
    check (provider in ('vercel')),
  provider_environment text not null default 'production'
    check (provider_environment in ('production', 'preview')),
  verification_state text not null default 'pending'
    check (verification_state in ('pending', 'verified', 'failed', 'unknown')),
  provider_verified boolean not null default false,
  dns_configured boolean not null default false,
  verified_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_domains_hostname_not_blank check (length(btrim(hostname)) > 0),
  constraint restaurant_domains_hostname_lowercase check (hostname = lower(hostname)),
  constraint restaurant_domains_one_per_restaurant unique (restaurant_id)
);

create unique index if not exists restaurant_domains_hostname_key
  on public.restaurant_domains (lower(hostname));

create index if not exists restaurant_domains_status_idx
  on public.restaurant_domains (status);

create index if not exists restaurant_domains_provider_environment_idx
  on public.restaurant_domains (provider, provider_environment);

drop trigger if exists restaurant_domains_set_updated_at on public.restaurant_domains;
create trigger restaurant_domains_set_updated_at
  before update on public.restaurant_domains
  for each row execute function public.set_updated_at();

alter table public.restaurant_domains enable row level security;

grant select on table public.restaurant_domains to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.restaurant_domains from anon, authenticated;

drop policy if exists "workspace members can view restaurant domains" on public.restaurant_domains;
create policy "workspace members can view restaurant domains"
  on public.restaurant_domains
  for select
  to authenticated
  using (public.can_access_restaurant(restaurant_id));

comment on table public.restaurant_domains is 'Customer-owned custom domains. Hosted slug.reservevia.com URLs are derived from restaurants.slug and are not stored here.';
comment on column public.restaurant_domains.hostname is 'Normalized lowercase ASCII/punycode hostname without scheme, path, query, fragment, or port.';
comment on column public.restaurant_domains.status is 'Local lifecycle state; active requires verified provider configuration and an entitled workspace.';
comment on column public.restaurant_domains.provider_verified is 'Server/provider-controlled verification result. Never writable through the browser Data API.';
comment on column public.restaurant_domains.dns_configured is 'Server/provider-controlled DNS and certificate readiness result.';
