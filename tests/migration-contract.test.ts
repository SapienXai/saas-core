import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260824000000_saas_core_v1.sql"), "utf8")

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
})
