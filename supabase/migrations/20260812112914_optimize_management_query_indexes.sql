-- Management authorization resolves memberships by user_id and then needs
-- workspace_id to select the active workspace. Keep both columns together in
-- the index so this hot path does not fall back to a second heap lookup.
create index if not exists workspace_members_user_workspace_idx
  on public.workspace_members (user_id, workspace_id);
