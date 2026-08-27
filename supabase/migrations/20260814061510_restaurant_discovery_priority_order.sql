-- Keep private business contact details private while exposing only the
-- minimum boolean signal needed for public discovery ordering.

alter table public.restaurants
  add column if not exists discovery_has_banner boolean generated always as (
    nullif(btrim(primary_image_url), '') is not null
  ) stored,
  add column if not exists discovery_has_business_email boolean not null default false;

comment on column public.restaurants.discovery_has_banner is
  'Computed public discovery asset signal for a primary/banner image.';

comment on column public.restaurants.discovery_has_business_email is
  'Boolean projection of a private restaurant claim business-contact email. The email itself is never public.';

update public.restaurants as restaurant
set discovery_has_business_email = exists (
  select 1
  from public.restaurant_claim_profiles as claim_profile
  where claim_profile.restaurant_id = restaurant.id
    and nullif(btrim(claim_profile.business_contact_email), '') is not null
);

create or replace function private.sync_restaurant_discovery_business_email()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'DELETE' then
    update public.restaurants
    set discovery_has_business_email = false
    where id = old.restaurant_id;
    return old;
  end if;

  update public.restaurants
  set discovery_has_business_email = nullif(btrim(new.business_contact_email), '') is not null
  where id = new.restaurant_id;
  return new;
end;
$$;

revoke all on function private.sync_restaurant_discovery_business_email() from public;
grant execute on function private.sync_restaurant_discovery_business_email() to service_role;

drop trigger if exists restaurant_claim_profiles_sync_discovery_business_email
  on public.restaurant_claim_profiles;

create trigger restaurant_claim_profiles_sync_discovery_business_email
  after insert or update of business_contact_email or delete
  on public.restaurant_claim_profiles
  for each row
  execute function private.sync_restaurant_discovery_business_email();

drop index if exists public.restaurants_public_discovery_order_idx;

create index if not exists restaurants_public_discovery_order_idx
  on public.restaurants (
    discovery_has_banner desc,
    discovery_has_business_email desc,
    discovery_score desc,
    updated_at desc,
    name asc,
    id asc
  )
  where status = 'published'
    and platform_status = 'active'
    and reservation_enabled = true;
