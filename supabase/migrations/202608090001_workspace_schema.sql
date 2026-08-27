-- Reservevia forward migration 001: workspace ownership foundation.
-- Historical scripts in scripts/sql/001-017 remain unchanged and are the
-- inherited baseline. Apply this migration only after that baseline exists.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (length(btrim(name)) > 0),
  constraint workspaces_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists workspaces_slug_key on public.workspaces (slug);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'admin', 'manager', 'staff', 'readonly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_members_workspace_user_key unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);
create index if not exists workspace_members_workspace_id_idx on public.workspace_members (workspace_id);

alter table public.restaurants
  add column if not exists workspace_id uuid;

create index if not exists restaurants_workspace_id_idx on public.restaurants (workspace_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_workspace_id_fkey'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id) on delete restrict;
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'workspaces_set_updated_at') then
    create trigger workspaces_set_updated_at
      before update on public.workspaces
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'workspace_members_set_updated_at') then
    create trigger workspace_members_set_updated_at
      before update on public.workspace_members
      for each row execute function public.set_updated_at();
  end if;
end $$;

comment on table public.workspaces is 'Reservevia customer/account boundary. Subscription ownership will belong here in a later phase.';
comment on table public.workspace_members is 'User membership and workspace-level role. readonly remains as a legacy compatibility role.';
comment on column public.restaurants.workspace_id is 'Additive tenant ownership. Historical rows are assigned by the next forward migration before this becomes required.';
