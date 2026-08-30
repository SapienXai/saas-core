import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { getActivePlatformNavigationKey, isPlatformNavigationVisible, resolvePlatformNavigationConfig } from "@/lib/platform-navigation"
import { formatPlatformRole } from "@/lib/platform-types"
import { formatPlatformTimestamp } from "@/components/platform/platform-generic"

describe("platform administration foundation", () => {
  it("keeps platform records readable without changing their stored values", () => {
    expect(formatPlatformRole("platform_owner")).toBe("Platform Owner")
    expect(formatPlatformRole("billing-admin")).toBe("Billing Admin")
    expect(formatPlatformRole(null)).toBe("Unknown role")
    expect(formatPlatformTimestamp("2026-08-30T11:55:22.885604+00:00")).toBe("30 Aug 2026, 11:55 UTC")
  })

  it("resolves product platform entries without widening role visibility", () => {
    const navigation = resolvePlatformNavigationConfig({
      platformNavigation: [
        { key: "catalog", label: "Catalog", href: "/platform/catalog", icon: "music", match: "prefix", platformRoles: ["platform_owner", "platform_admin"], legacyPaths: ["/catalog-admin"] },
        { key: "unsafe", label: "Unsafe", href: "/app/anything" },
        { key: "billing", label: "Duplicate billing", href: "/platform/billing", platformRoles: ["support"] },
      ],
    })
    const catalog = navigation.find((item) => item.key === "catalog")
    const billing = navigation.find((item) => item.key === "billing")
    expect(catalog).toBeDefined()
    expect(isPlatformNavigationVisible(catalog!, "platform_admin")).toBe(true)
    expect(isPlatformNavigationVisible(catalog!, "support")).toBe(false)
    expect(isPlatformNavigationVisible(billing!, "support")).toBe(false)
    expect(getActivePlatformNavigationKey("/platform/catalog/tracks/new", navigation)).toBe("catalog")
    expect(getActivePlatformNavigationKey("/catalog-admin/tracks/new", navigation)).toBe("catalog")
    expect(navigation.some((item) => item.key === "unsafe")).toBe(false)
  })

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
