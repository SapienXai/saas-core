import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("platform administration foundation", () => {
  it("keeps platform authorization data server-controlled in the migration", () => {
    const migration = readFileSync("supabase/migrations/20260810214013_platform_admin_foundation.sql", "utf8")
    expect(migration).toContain("create table if not exists public.platform_members")
    expect(migration).toContain("create table if not exists public.platform_audit_logs")
    expect(migration).toContain("alter table public.platform_members enable row level security")
    expect(migration).toContain("revoke all on public.platform_members from anon, authenticated")
    expect(migration).toContain("platform_status")
  })
})
