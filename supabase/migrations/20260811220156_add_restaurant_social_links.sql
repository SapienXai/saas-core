-- Public social profiles managed from the restaurant profile editor.
-- Keep the shape extensible while allowing the application to expose only
-- known, validated platforms.

alter table public.restaurants
  add column if not exists social_links jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_social_links_object_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_social_links_object_check
      check (jsonb_typeof(social_links) = 'object');
  end if;
end $$;

comment on column public.restaurants.social_links is
  'Validated public social profile URLs keyed by platform, for example instagram or facebook.';
