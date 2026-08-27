-- Per-field public profile controls for the restaurant editor.
-- An empty object keeps the legacy behavior: all existing fields remain visible.

alter table public.restaurants
  add column if not exists profile_visibility jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_profile_visibility_object_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_profile_visibility_object_check
      check (jsonb_typeof(profile_visibility) = 'object');
  end if;
end $$;

comment on column public.restaurants.profile_visibility is
  'Optional per-field public profile visibility flags. Missing keys use the default visible state.';
