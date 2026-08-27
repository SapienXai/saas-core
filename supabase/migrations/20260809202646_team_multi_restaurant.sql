-- Reservevia Phase 7: team invitations, restaurant-scoped membership access,
-- and the first incremental multi-restaurant management primitives.
--
-- workspace_members remains the authorization source of truth. Invitation
-- tokens are hashed before storage, membership writes are server/database
-- controlled, and existing memberships are backfilled with all-restaurant
-- access so inherited Felix behavior remains unchanged.

alter table public.workspace_members
  add column if not exists restaurant_access_mode text not null default 'all';

alter table public.workspace_members
  drop constraint if exists workspace_members_restaurant_access_mode_check;

alter table public.workspace_members
  add constraint workspace_members_restaurant_access_mode_check
  check (restaurant_access_mode in ('all', 'selected'));

create table if not exists public.workspace_member_restaurants (
  member_id uuid not null references public.workspace_members(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, restaurant_id)
);

create index if not exists workspace_member_restaurants_restaurant_idx
  on public.workspace_member_restaurants (restaurant_id, member_id);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  normalized_email text not null,
  role text not null check (role in ('admin', 'manager', 'staff')),
  restaurant_access_mode text not null default 'all'
    check (restaurant_access_mode in ('all', 'selected')),
  invited_by uuid references auth.users(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_sent_at timestamptz not null default now(),
  email_delivery_status text not null default 'pending'
    check (email_delivery_status in ('pending', 'sent', 'failed')),
  delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_invitations_email_check
    check (length(normalized_email) between 3 and 320),
  constraint workspace_invitations_normalized_email_check
    check (normalized_email = lower(btrim(normalized_email)))
);

create unique index if not exists workspace_invitations_active_email_key
  on public.workspace_invitations (workspace_id, normalized_email)
  where accepted_at is null and revoked_at is null;

create index if not exists workspace_invitations_workspace_status_idx
  on public.workspace_invitations (workspace_id, expires_at)
  where accepted_at is null and revoked_at is null;

create table if not exists public.workspace_invitation_restaurants (
  invitation_id uuid not null references public.workspace_invitations(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invitation_id, restaurant_id)
);

create index if not exists workspace_invitation_restaurants_restaurant_idx
  on public.workspace_invitation_restaurants (restaurant_id, invitation_id);

create trigger workspace_invitations_set_updated_at
  before update on public.workspace_invitations
  for each row execute function public.set_updated_at();

-- Existing workspaces historically granted managers workspace-wide access.
-- Preserve that behavior for all migrated members; new selected access is
-- opt-in through invitation/member management.
update public.workspace_members
set restaurant_access_mode = 'all'
where restaurant_access_mode is distinct from 'all';

create or replace function private.enforce_workspace_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  user_limit integer;
  member_count integer;
  pending_invitation_count integer;
begin
  perform 1
  from public.workspace_subscriptions
  where workspace_id = new.workspace_id
  for update;

  select plan.user_limit
    into user_limit
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key
  where subscription.workspace_id = new.workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');

  if user_limit is null then
    select free_plan.user_limit into user_limit
    from public.plans as free_plan
    where free_plan.key = 'free';
  end if;

  select count(*) into member_count
  from public.workspace_members
  where workspace_id = new.workspace_id;

  select count(*) into pending_invitation_count
  from public.workspace_invitations
  where workspace_id = new.workspace_id
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  if user_limit is not null and member_count + pending_invitation_count >= user_limit then
    raise exception using
      errcode = 'P0001',
      message = 'User limit reached for the current plan.',
      detail = 'USER_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

comment on column public.workspace_members.restaurant_access_mode is 'all grants workspace restaurant access; selected uses workspace_member_restaurants.';
comment on table public.workspace_invitations is 'Hashed, expiring team invitations. Pending valid rows reserve user seats.';
comment on table public.workspace_member_restaurants is 'Normalized selected restaurant access for workspace members.';

create or replace function private.user_can_access_restaurant(
  target_restaurant_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.restaurants as restaurant
    join public.workspace_members as membership
      on membership.workspace_id = restaurant.workspace_id
    join public.workspaces as workspace
      on workspace.id = membership.workspace_id
    where restaurant.id = target_restaurant_id
      and membership.user_id = target_user_id
      and workspace.status = 'active'
      and (
        membership.role in ('owner', 'admin')
        or membership.restaurant_access_mode = 'all'
        or exists (
          select 1
          from public.workspace_member_restaurants as assignment
          where assignment.member_id = membership.id
            and assignment.restaurant_id = target_restaurant_id
        )
      )
  );
$$;

create or replace function private.user_can_operate_restaurant(
  target_restaurant_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.restaurants as restaurant
    join public.workspace_members as membership
      on membership.workspace_id = restaurant.workspace_id
    join public.workspaces as workspace
      on workspace.id = membership.workspace_id
    where restaurant.id = target_restaurant_id
      and membership.user_id = target_user_id
      and workspace.status = 'active'
      and membership.role in ('owner', 'admin', 'manager', 'staff')
      and (
        membership.role in ('owner', 'admin')
        or membership.restaurant_access_mode = 'all'
        or exists (
          select 1
          from public.workspace_member_restaurants as assignment
          where assignment.member_id = membership.id
            and assignment.restaurant_id = target_restaurant_id
        )
      )
  );
$$;

create or replace function private.can_manage_restaurant_asset_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, storage
as $$
declare
  parts text[];
  workspace_id_value uuid;
  restaurant_id_value uuid;
begin
  if object_name !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/(logo|primary)/[^/]+$' then
    return false;
  end if;
  parts := storage.foldername(object_name);
  begin
    workspace_id_value := parts[1]::uuid;
    restaurant_id_value := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1
    from public.restaurants as restaurant
    join public.workspace_members as membership on membership.workspace_id = restaurant.workspace_id
    join public.workspaces as workspace on workspace.id = membership.workspace_id
    where restaurant.id = restaurant_id_value
      and restaurant.workspace_id = workspace_id_value
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin', 'manager')
      and workspace.status = 'active'
      and (
        membership.role in ('owner', 'admin')
        or membership.restaurant_access_mode = 'all'
        or exists (
          select 1 from public.workspace_member_restaurants as assignment
          where assignment.member_id = membership.id and assignment.restaurant_id = restaurant_id_value
        )
      )
  );
end;
$$;

-- Existing RLS policies call these public function signatures. Keep the
-- compatibility wrappers, but do not allow an authenticated caller to ask
-- about another user's access.
create or replace function public.is_workspace_member(
  target_workspace_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when auth.uid() is not null and target_user_id is distinct from auth.uid() then false
    else exists (
      select 1
      from public.workspace_members as membership
      join public.workspaces as workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = target_workspace_id
        and membership.user_id = target_user_id
        and workspace.status = 'active'
    )
  end;
$$;

create or replace function public.has_workspace_role(
  target_workspace_id uuid,
  allowed_roles text[],
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when auth.uid() is not null and target_user_id is distinct from auth.uid() then false
    else exists (
      select 1
      from public.workspace_members as membership
      join public.workspaces as workspace on workspace.id = membership.workspace_id
      where membership.workspace_id = target_workspace_id
        and membership.user_id = target_user_id
        and membership.role = any(allowed_roles)
        and workspace.status = 'active'
    )
  end;
$$;

create or replace function public.can_access_restaurant(
  target_restaurant_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when auth.uid() is not null and target_user_id is distinct from auth.uid() then false
    else private.user_can_access_restaurant(target_restaurant_id, target_user_id)
  end;
$$;

create or replace function public.can_operate_restaurant(
  target_restaurant_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when auth.uid() is not null and target_user_id is distinct from auth.uid() then false
    else private.user_can_operate_restaurant(target_restaurant_id, target_user_id)
  end;
$$;

revoke all on function public.is_workspace_member(uuid, uuid) from public, anon;
revoke all on function public.has_workspace_role(uuid, text[], uuid) from public, anon;
revoke all on function public.can_access_restaurant(uuid, uuid) from public, anon;
revoke all on function public.can_operate_restaurant(uuid, uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, text[], uuid) to authenticated;
grant execute on function public.can_access_restaurant(uuid, uuid) to authenticated;
grant execute on function public.can_operate_restaurant(uuid, uuid) to authenticated;

-- Authenticated clients can read their own memberships and authorized admins
-- can read the workspace roster. All membership/invitation writes go through
-- trusted server actions or the two authenticated RPCs below.
alter table public.workspace_member_restaurants enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_invitation_restaurants enable row level security;

drop policy if exists "Owners and admins can manage workspace memberships" on public.workspace_members;
drop policy if exists "Members can read workspace memberships" on public.workspace_members;
create policy "Members can read workspace memberships"
  on public.workspace_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_workspace_role(workspace_id, array['owner', 'admin'])
  );

create policy "Members can read their restaurant assignments"
  on public.workspace_member_restaurants for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members as member
      where member.id = member_id
        and (
          member.user_id = (select auth.uid())
          or public.has_workspace_role(member.workspace_id, array['owner', 'admin'])
        )
    )
  );

create policy "Owners and admins can read workspace invitations"
  on public.workspace_invitations for select
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "Owners and admins can read invitation assignments"
  on public.workspace_invitation_restaurants for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_invitations as invitation
      where invitation.id = invitation_id
        and public.has_workspace_role(invitation.workspace_id, array['owner', 'admin'])
    )
  );

revoke insert, update, delete on public.workspace_members from anon, authenticated;
revoke insert, update, delete on public.workspace_member_restaurants from anon, authenticated;
revoke insert, update, delete on public.workspace_invitations from anon, authenticated;
revoke insert, update, delete on public.workspace_invitation_restaurants from anon, authenticated;
grant select on public.workspace_members to authenticated;
grant select on public.workspace_member_restaurants to authenticated;
grant select on public.workspace_invitations to authenticated;
grant select on public.workspace_invitation_restaurants to authenticated;

-- Restaurant-owned data must follow the same selected-access decision as the
-- application layer. Owner/Admin remain workspace-wide; Manager/Staff are
-- constrained to all or selected restaurant scope.
drop policy if exists "Workspace managers can update restaurants" on public.restaurants;
create policy "Workspace managers can update restaurants"
  on public.restaurants for update
  to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    or (
      public.has_workspace_role(workspace_id, array['manager'])
      and public.can_access_restaurant(id)
    )
  )
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    or (
      public.has_workspace_role(workspace_id, array['manager'])
      and public.can_access_restaurant(id)
    )
  );

drop policy if exists "Workspace managers can manage notification settings" on public.notification_settings;
create policy "Workspace managers can manage notification settings"
  on public.notification_settings for all
  to authenticated
  using (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager'])
  )
  with check (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager'])
  );

drop policy if exists "Workspace managers can manage reservation areas" on public.reservation_areas;
create policy "Workspace managers can manage reservation areas"
  on public.reservation_areas for all
  to authenticated
  using (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager'])
  )
  with check (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager'])
  );

drop policy if exists "Workspace managers can delete reservations" on public.reservations;
create policy "Workspace managers can delete reservations"
  on public.reservations for delete
  to authenticated
  using (
    public.can_access_restaurant(restaurant_id)
    and public.has_workspace_role((select workspace_id from public.restaurants where id = restaurant_id), array['owner', 'admin', 'manager'])
  );

drop policy if exists "Workspace members can read domains" on public.restaurant_domains;
create policy "Workspace members can read domains"
  on public.restaurant_domains for select
  to authenticated
  using (public.can_access_restaurant(restaurant_id));

-- Invitation creation is serialized by the workspace subscription row. The
-- plan seat check includes active members and valid pending invitations.
create or replace function public.create_workspace_invitation(
  target_workspace_id uuid,
  target_email text,
  target_role text,
  target_access_mode text default 'all',
  target_selected_restaurant_ids uuid[] default '{}'::uuid[],
  target_token_hash text default null
)
returns table (
  invitation_id uuid,
  workspace_id uuid,
  normalized_email text,
  role text,
  restaurant_access_mode text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := auth.uid();
  inviter_role text;
  normalized text := lower(btrim(coalesce(target_email, '')));
  user_limit integer;
  member_count integer;
  pending_count integer;
  selected_count integer;
  existing_invitation uuid;
  new_invitation public.workspace_invitations%rowtype;
  selected_ids uuid[] := coalesce(target_selected_restaurant_ids, '{}'::uuid[]);
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION_TOKEN';
  end if;
  if length(normalized) < 3 or length(normalized) > 320 or position('@' in normalized) < 2 then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION_EMAIL';
  end if;
  if target_role not in ('admin', 'manager', 'staff') then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION_ROLE';
  end if;
  if target_access_mode not in ('all', 'selected') then
    raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_ACCESS_MODE';
  end if;

  select membership.role into inviter_role
  from public.workspace_members as membership
  join public.workspaces as workspace on workspace.id = membership.workspace_id
  where membership.workspace_id = target_workspace_id
    and membership.user_id = current_user_id
    and workspace.status = 'active';

  if inviter_role is null then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_ACCESS_REQUIRED';
  end if;
  if inviter_role not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'TEAM_MANAGEMENT_REQUIRED';
  end if;
  if inviter_role = 'admin' and target_role = 'admin' then
    raise exception using errcode = 'P0001', message = 'ROLE_HIERARCHY_REJECTED';
  end if;

  -- Keep the lock order subscription -> invitation/member state consistent
  -- with membership and restaurant-limit triggers.
  perform 1 from public.workspace_subscriptions as subscription_lock
  where subscription_lock.workspace_id = target_workspace_id
  for update;

  if exists (
    select 1
    from auth.users as auth_user
    join public.workspace_members as member on member.user_id = auth_user.id
    where member.workspace_id = target_workspace_id
      and lower(auth_user.email) = normalized
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_MEMBER';
  end if;

  select invitation.id into existing_invitation
  from public.workspace_invitations as invitation
  where invitation.workspace_id = target_workspace_id
    and invitation.normalized_email = normalized
    and invitation.accepted_at is null
    and invitation.revoked_at is null
  order by invitation.created_at desc
  limit 1
  for update;

  if existing_invitation is not null then
    raise exception using errcode = 'P0001', message = 'INVITATION_ALREADY_PENDING';
  end if;

  select plan.user_limit into user_limit
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key
  where subscription.workspace_id = target_workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');
  if user_limit is null then
    select free_plan.user_limit into user_limit from public.plans as free_plan where free_plan.key = 'free';
  end if;

  select count(*) into member_count
  from public.workspace_members as member_count_row where member_count_row.workspace_id = target_workspace_id;
  select count(*) into pending_count
  from public.workspace_invitations as pending_invitation
  where pending_invitation.workspace_id = target_workspace_id
    and pending_invitation.accepted_at is null and pending_invitation.revoked_at is null and pending_invitation.expires_at > now();

  if user_limit is not null and member_count + pending_count >= user_limit then
    raise exception using errcode = 'P0001', message = 'USER_LIMIT_REACHED', detail = 'USER_LIMIT_REACHED';
  end if;

  if target_role in ('admin', 'owner') then
    target_access_mode := 'all';
    selected_ids := '{}'::uuid[];
  elsif target_access_mode = 'selected' then
    if cardinality(selected_ids) = 0 then
      raise exception using errcode = 'P0001', message = 'RESTAURANT_SELECTION_REQUIRED';
    end if;
    select count(*) into selected_count
    from public.restaurants as selected_restaurant
    where selected_restaurant.workspace_id = target_workspace_id and selected_restaurant.id = any(selected_ids);
    if selected_count <> cardinality(selected_ids) then
      raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_SELECTION';
    end if;
  else
    selected_ids := '{}'::uuid[];
  end if;

  insert into public.workspace_invitations (
    workspace_id, email, normalized_email, role, restaurant_access_mode,
    invited_by, token_hash, expires_at, last_sent_at
  ) values (
    target_workspace_id, btrim(target_email), normalized, target_role,
    target_access_mode, current_user_id, target_token_hash,
    now() + interval '7 days', now()
  ) returning * into new_invitation;

  if target_access_mode = 'selected' then
    insert into public.workspace_invitation_restaurants (invitation_id, restaurant_id)
    select new_invitation.id, selected_id
    from unnest(selected_ids) as selected_id;
  end if;

  return query select new_invitation.id, new_invitation.workspace_id,
    new_invitation.normalized_email, new_invitation.role,
    new_invitation.restaurant_access_mode, new_invitation.expires_at;
end;
$$;

create or replace function public.accept_workspace_invitation(target_token_hash text)
returns table (
  workspace_id uuid,
  member_id uuid,
  role text,
  restaurant_access_mode text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  invitation public.workspace_invitations%rowtype;
  member public.workspace_members%rowtype;
  user_limit integer;
  member_count integer;
  compatibility_role text;
  selected_restaurant_id uuid;
  selected_restaurant_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION';
  end if;

  select lower(email) into current_email from auth.users where id = current_user_id;
  select * into invitation from public.workspace_invitations
  where token_hash = target_token_hash;
  if invitation.id is null then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND';
  end if;

  -- Match invitation acceptance to the current workspace billing/member lock.
  perform 1 from public.workspace_subscriptions as subscription_lock
  where subscription_lock.workspace_id = invitation.workspace_id
  for update;

  select * into invitation from public.workspace_invitations
  where id = invitation.id
  for update;
  if invitation.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'INVITATION_ALREADY_ACCEPTED';
  end if;
  if invitation.revoked_at is not null or invitation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'INVITATION_EXPIRED';
  end if;
  if current_email is null or current_email <> invitation.normalized_email then
    raise exception using errcode = 'P0001', message = 'INVITATION_EMAIL_MISMATCH';
  end if;
  if exists (
    select 1 from public.workspace_members as existing_member
    where existing_member.workspace_id = invitation.workspace_id and existing_member.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_MEMBER';
  end if;

  select plan.user_limit into user_limit
  from public.workspace_subscriptions as subscription
  join public.plans as plan on plan.key = subscription.plan_key
  where subscription.workspace_id = invitation.workspace_id
    and subscription.status in ('active', 'trialing', 'past_due', 'canceled');
  if user_limit is null then
    select free_plan.user_limit into user_limit from public.plans as free_plan where free_plan.key = 'free';
  end if;
  select count(*) into member_count
  from public.workspace_members as member_count_row where member_count_row.workspace_id = invitation.workspace_id;
  if user_limit is not null and member_count >= user_limit then
    raise exception using errcode = 'P0001', message = 'USER_LIMIT_REACHED', detail = 'USER_LIMIT_REACHED';
  end if;

  -- Mark the invite accepted before the member insert so the member-limit
  -- trigger does not count the same seat twice. Any failure rolls back both.
  update public.workspace_invitations
  set accepted_at = now(), updated_at = now()
  where id = invitation.id;

  insert into public.workspace_members (workspace_id, user_id, role, restaurant_access_mode)
  values (invitation.workspace_id, current_user_id, invitation.role, invitation.restaurant_access_mode)
  returning * into member;

  if invitation.restaurant_access_mode = 'selected' then
    insert into public.workspace_member_restaurants (member_id, restaurant_id)
    select member.id, assignment.restaurant_id
    from public.workspace_invitation_restaurants as assignment
    where assignment.invitation_id = invitation.id;
  end if;

  -- Preserve the minimum legacy profile bridge only when no row exists. A
  -- global admin_profiles role is never allowed to override membership auth.
  compatibility_role := case when invitation.role = 'admin' then 'admin' else invitation.role end;
  select count(*) into selected_restaurant_count
  from public.workspace_invitation_restaurants
  where invitation_id = invitation.id;
  select restaurant_id into selected_restaurant_id
  from public.workspace_invitation_restaurants
  where invitation_id = invitation.id
  order by restaurant_id
  limit 1;
  insert into public.admin_profiles (id, role, restaurant_id)
  values (
    current_user_id,
    compatibility_role,
    case when invitation.restaurant_access_mode = 'selected' and selected_restaurant_count = 1
      then selected_restaurant_id else null end
  )
  on conflict (id) do nothing;

  return query select member.workspace_id, member.id, member.role, member.restaurant_access_mode;
end;
$$;

-- Role and restaurant-scope changes must update the membership and its
-- normalized assignments in one transaction. The browser never receives
-- direct write privileges for either table.
create or replace function public.update_workspace_member(
  target_workspace_id uuid,
  target_member_id uuid,
  target_role text,
  target_access_mode text default 'all',
  target_selected_restaurant_ids uuid[] default '{}'::uuid[]
)
returns table (
  member_id uuid,
  role text,
  restaurant_access_mode text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := auth.uid();
  actor_role text;
  target_member public.workspace_members%rowtype;
  selected_ids uuid[] := coalesce(target_selected_restaurant_ids, '{}'::uuid[]);
  selected_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if target_role not in ('admin', 'manager', 'staff') then
    raise exception using errcode = 'P0001', message = 'ROLE_HIERARCHY_REJECTED';
  end if;
  if target_access_mode not in ('all', 'selected') then
    raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_ACCESS_MODE';
  end if;

  select *
    into target_member
  from public.workspace_members
  where id = target_member_id
    and workspace_id = target_workspace_id
  for update;

  if target_member.id is null then
    raise exception using errcode = 'P0001', message = 'MEMBER_NOT_FOUND';
  end if;

  select member.role
    into actor_role
  from public.workspace_members as member
  join public.workspaces as workspace on workspace.id = member.workspace_id
  where member.user_id = current_user_id
    and member.workspace_id = target_member.workspace_id
    and workspace.status = 'active'
    and member.role in ('owner', 'admin')
  order by case when member.role = 'owner' then 0 else 1 end
  limit 1;

  if actor_role is null then
    raise exception using errcode = 'P0001', message = 'TEAM_MANAGEMENT_REQUIRED';
  end if;

  if target_member.role = 'owner' then
    raise exception using errcode = 'P0001', message = 'OWNER_PROTECTED';
  end if;
  if actor_role = 'admin' and (target_member.role = 'admin' or target_role = 'admin') then
    raise exception using errcode = 'P0001', message = 'ROLE_HIERARCHY_REJECTED';
  end if;

  if target_role = 'admin' then
    target_access_mode := 'all';
    selected_ids := '{}'::uuid[];
  elsif target_access_mode = 'selected' then
    if cardinality(selected_ids) = 0 then
      raise exception using errcode = 'P0001', message = 'RESTAURANT_SELECTION_REQUIRED';
    end if;
    select count(*)
      into selected_count
    from public.restaurants as restaurant
    where restaurant.workspace_id = target_member.workspace_id
      and restaurant.id = any(selected_ids);
    if selected_count <> cardinality(selected_ids) then
      raise exception using errcode = 'P0001', message = 'INVALID_RESTAURANT_SELECTION';
    end if;
  else
    selected_ids := '{}'::uuid[];
  end if;

  update public.workspace_members
  set role = target_role,
      restaurant_access_mode = target_access_mode,
      updated_at = now()
  where id = target_member.id;

  delete from public.workspace_member_restaurants as assignment
  where assignment.member_id = target_member.id;

  if target_access_mode = 'selected' then
    insert into public.workspace_member_restaurants (member_id, restaurant_id)
    select target_member.id, selected_id
    from unnest(selected_ids) as selected_id;
  end if;

  return query select target_member.id, target_role, target_access_mode;
end;
$$;

revoke all on function public.create_workspace_invitation(uuid, text, text, text, uuid[], text) from public, anon;
revoke all on function public.accept_workspace_invitation(text) from public, anon;
revoke all on function public.update_workspace_member(uuid, uuid, text, text, uuid[]) from public, anon;
grant execute on function public.create_workspace_invitation(uuid, text, text, text, uuid[], text) to authenticated;
grant execute on function public.accept_workspace_invitation(text) to authenticated;
grant execute on function public.update_workspace_member(uuid, uuid, text, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
