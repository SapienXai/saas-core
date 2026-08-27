-- Reservevia public surface selection for customer-owned domains.
-- The existing restaurant_domains table remains the single verified domain
-- registry; this additive field lets an entitled workspace use one domain for
-- its brand booking surface without changing existing restaurant domains.

alter table public.restaurant_domains
  add column if not exists public_surface text not null default 'restaurant';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurant_domains_public_surface_check'
      and conrelid = 'public.restaurant_domains'::regclass
  ) then
    alter table public.restaurant_domains
      add constraint restaurant_domains_public_surface_check
      check (public_surface in ('restaurant', 'brand'));
  end if;
end $$;

create index if not exists restaurant_domains_public_surface_idx
  on public.restaurant_domains (public_surface, status);

comment on column public.restaurant_domains.public_surface is 'Verified domain destination. Restaurant is the legacy default; brand is an entitled workspace-wide booking page.';

notify pgrst, 'reload schema';
