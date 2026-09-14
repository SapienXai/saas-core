-- Additive fix for the published entitlement-enforcement migration.
--
-- The previous function used unqualified RETURNING expressions inside a
-- function that also exposes an OUT parameter named `email`. PostgreSQL could
-- therefore resolve `email` to either the table column or the PL/pgSQL
-- variable. Keep the public signature and behavior unchanged while making
-- every returned column explicit.

create or replace function public.renew_workspace_invitation(
  target_invitation_id uuid,
  target_token_hash text
)
returns table (invitation_id uuid, email text, role text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor uuid := auth.uid();
  invite public.workspace_invitations%rowtype;
  now_at timestamptz := now();
  renewed_invitation_id uuid;
  renewed_email text;
  renewed_role text;
  renewed_expires_at timestamptz;
begin
  if actor is null then raise exception using message = 'AUTH_REQUIRED'; end if;
  if target_invitation_id is null or nullif(btrim(coalesce(target_token_hash, '')), '') is null then
    raise exception using message = 'INVALID_INVITATION_REQUEST';
  end if;
  select * into invite
    from public.workspace_invitations
   where id = target_invitation_id
   for update;
  if not found then raise exception using message = 'INVITATION_NOT_FOUND'; end if;
  if not public.has_workspace_role(invite.workspace_id, array['owner', 'admin'], actor) then
    raise exception using message = 'FORBIDDEN';
  end if;
  if invite.accepted_at is not null or invite.revoked_at is not null then
    raise exception using message = 'INVITATION_NOT_PENDING';
  end if;
  if invite.last_sent_at is not null and invite.last_sent_at > now_at - interval '60 seconds' then
    raise exception using message = 'INVITATION_RESEND_COOLDOWN';
  end if;

  -- Exclude this invitation because an unexpired row already reserves its
  -- seat; an expired row is renewed only when the target plan has capacity.
  perform private.assert_workspace_member_available(invite.workspace_id, invite.id);
  update public.workspace_invitations as invitation
     set token_hash = target_token_hash,
         expires_at = now_at + interval '7 days',
         last_sent_at = now_at,
         email_delivery_status = 'pending',
         delivery_error = null,
         updated_at = now_at
   where invitation.id = invite.id
   returning invitation.id, invitation.email, invitation.role, invitation.expires_at
        into renewed_invitation_id, renewed_email, renewed_role, renewed_expires_at;
  return query select renewed_invitation_id, renewed_email, renewed_role, renewed_expires_at;
end;
$$;

revoke all on function public.renew_workspace_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.renew_workspace_invitation(uuid, text) to authenticated;

notify pgrst, 'reload schema';
