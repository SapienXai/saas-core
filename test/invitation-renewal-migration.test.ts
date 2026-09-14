import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const rootMigration = "supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql"
const templateMigration = "packages/app/template/supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql"

describe("workspace invitation renewal hardening", () => {
  it("ships an additive, qualified replacement without weakening the RPC boundary", () => {
    const migration = readFileSync(rootMigration, "utf8")
    expect(readFileSync(templateMigration, "utf8")).toBe(migration)
    expect(migration).toContain("create or replace function public.renew_workspace_invitation(")
    expect(migration).toContain("update public.workspace_invitations as invitation")
    expect(migration).toContain("where invitation.id = invite.id")
    expect(migration).toContain("returning invitation.id, invitation.email, invitation.role, invitation.expires_at")
    expect(migration).not.toContain("returning id, email, role, expires_at into")
    expect(migration).toContain("security definer")
    expect(migration).toContain("set search_path = public, private")
    expect(migration).toContain("grant execute on function public.renew_workspace_invitation(uuid, text) to authenticated")
  })
})
