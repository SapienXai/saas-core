-- Restaurant names are display values and may legitimately repeat across
-- workspaces. Public slugs remain globally unique and are the URL identity.
alter table public.restaurants
  drop constraint if exists restaurants_name_key;

