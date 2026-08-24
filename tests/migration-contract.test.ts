import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260824000000_saas_core_v1.sql"), "utf8")
const hardening = readFileSync(join(process.cwd(), "supabase/migrations/20260824010000_production_hardening.sql"), "utf8")
const finalHardening = readFileSync(join(process.cwd(), "supabase/migrations/20260824020000_final_p0_hardening.sql"), "utf8")

describe("Core migration contract", () => {
  it("owns only product-neutral tables and enables tenant defense in depth", () => {
    expect(migration).toContain("create table if not exists public.workspaces")
    expect(migration).toContain("alter table public.workspaces enable row level security")
    expect(migration).toContain("security definer")
    expect(migration).toContain("auth.uid()")
    expect(migration).not.toMatch(/create table[^;]+resources/i)
    expect(migration).not.toMatch(/restaurant|reservation|hotel|booking/i)
  })

  it("contains ordered webhook, usage and invitation safety boundaries", () => {
    expect(migration).toContain("unique (provider, provider_event_id)")
    expect(migration).toContain("for update")
    expect(migration).toContain("private.create_workspace_invitation")
    expect(migration).toContain("private.accept_workspace_invitation")
    expect(migration).toContain("token_hash")
  })

  it("moves sensitive authenticated mutations behind hardened RPCs", () => {
    expect(hardening).toContain("drop policy if exists workspace_members_mutate")
    expect(hardening).toContain("create or replace function public.change_member_role")
    expect(hardening).toContain("OWNER_PROTECTED")
    expect(hardening).toContain("INVITATION_RESEND_COOLDOWN")
    expect(hardening).toContain("private.effective_plan_limit")
    expect(hardening).toContain("for update")
    expect(hardening).not.toMatch(/create policy[^;]+workspace_members[^;]+for all/i)
  })

  it("serializes seat decisions and keeps platform audit functions volatile", () => {
    expect(finalHardening).toContain("pg_advisory_xact_lock")
    expect(finalHardening).toContain("mark_invitation_delivery")
    expect(finalHardening).toContain("expire_payment_grace")
    expect(finalHardening).toContain("create or replace function public.platform_workspace_360")
    const workspace360 = finalHardening.slice(finalHardening.indexOf("create or replace function public.platform_workspace_360"), finalHardening.indexOf("create or replace function public.platform_list_users"))
    expect(workspace360).not.toContain("language plpgsql stable")
  })
})
