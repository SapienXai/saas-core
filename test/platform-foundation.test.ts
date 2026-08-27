import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("platform administration foundation", () => {
  it("keeps platform authorization data server-controlled in the migration", () => {
    const migration = readFileSync("supabase/migrations/20260827204359_saas_core_v2_baseline.sql", "utf8")
    expect(migration).toContain("create table public.platform_members")
    expect(migration).toContain("create table public.platform_audit_logs")
    expect(migration).toContain("alter table public.platform_members enable row level security")
    expect(migration).toContain("revoke all on public.platform_members, public.platform_user_controls, public.platform_audit_logs, public.platform_settings from anon, authenticated")
    expect(migration).toContain("create table public.platform_settings")
    expect(migration).toContain("create or replace function public.is_platform_member")
  })
})
