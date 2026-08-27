-- The directory is server-only, but PostgREST still needs its schema cache
-- refreshed after the table is created so service-role REST queries can see it.
grant all on table public.platform_user_directory to service_role;
notify pgrst, 'reload schema';
