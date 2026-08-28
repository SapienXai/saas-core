-- Product-owned reference extension. This file is not part of the Core baseline.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy projects_member_read on public.projects
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy projects_manager_write on public.projects
  for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'manager']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'manager']));
