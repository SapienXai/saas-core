-- Keep the safe platform identity projection in sync when an Auth identity is deleted.
create or replace function private.remove_platform_user_directory()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  delete from public.platform_user_directory where user_id = old.id;
  return old;
end;
$$;

revoke all on function private.remove_platform_user_directory() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'platform_user_directory_after_auth_user_delete') then
    create trigger platform_user_directory_after_auth_user_delete
      after delete on auth.users
      for each row execute function private.remove_platform_user_directory();
  end if;
end $$;
