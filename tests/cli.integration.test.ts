import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { runCli } from "../packages/core/src/cli.js"

const created: string[] = []
afterEach(() => { for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe("CLI generated project contract", () => {
  it("creates a real App Router project and preserves product-owned files on update", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saas-core-cli-"))
    created.push(directory)
    await runCli(["init", directory, "--yes", "--non-interactive"])
    const manifest = JSON.parse(readFileSync(join(directory, ".saas-core.json"), "utf8"))
    expect(manifest.coreVersion).toBe("1.1.0")
    expect(manifest.schemaVersion).toBe("1.3.0")
    expect(readFileSync(join(directory, "package.json"), "utf8")).toContain('"next": "16.3.0"')
    expect(readFileSync(join(directory, "proxy.ts"), "utf8")).toContain("createServerSupabaseClient")
    await runCli(["update", directory, "--dry-run"])
    expect(readFileSync(join(directory, "src/product/README.md"), "utf8")).toContain("Product-owned")
  })

  it("updates a v0.9 fixture with a checkpoint, migration addition, package merge, and conflict preservation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saas-core-cli-update-"))
    created.push(directory)
    await runCli(["init", directory, "--yes", "--non-interactive"])
    const manifestPath = join(directory, ".saas-core.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    manifest.coreVersion = "0.9.0"
    manifest.schemaVersion = "0.9"
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
    const pagePath = join(directory, "src/app/page.tsx")
    writeFileSync(pagePath, readFileSync(pagePath, "utf8") + "\n// product-owned customization\n")
    const packagePath = join(directory, "package.json")
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))
    packageJson.dependencies["@sapienx/saas-core"] = "^0.9.0"
    writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n")
    const migrationPath = join(directory, "supabase/migrations/20260824020000_final_p0_hardening.sql")
    rmSync(migrationPath)
    const beforeDryRun = readFileSync(packagePath, "utf8")
    await runCli(["update", directory, "--dry-run"])
    expect(readFileSync(packagePath, "utf8")).toBe(beforeDryRun)
    await runCli(["update", directory])
    expect(readFileSync(packagePath, "utf8")).toContain('"@sapienx/saas-core": "^1.1.0"')
    expect(readFileSync(pagePath, "utf8")).toContain("product-owned customization")
    expect(existsSync(migrationPath)).toBe(true)
    expect(readdirSync(join(directory, ".saas-core-backup")).length).toBeGreaterThan(0)
    const updated = JSON.parse(readFileSync(manifestPath, "utf8"))
    expect(updated.coreVersion).toBe("1.1.0")
    expect(updated.schemaVersion).toBe("1.3.0")
    expect(updated.managedFiles["supabase/migrations/20260824020000_final_p0_hardening.sql"]).toBeTruthy()
  })
})
