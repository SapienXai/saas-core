import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { runCli } from "../packages/core/src/cli.js"

const created: string[] = []
afterEach(() => { for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const corePackages = [
  "@sapienx/saas-core",
  "@sapienx/saas-core-auth",
  "@sapienx/saas-core-config",
  "@sapienx/saas-core-runtime",
  "@sapienx/saas-core-billing",
  "@sapienx/saas-core-notifications",
  "@sapienx/saas-core-ui",
  "@sapienx/saas-core-domains",
]
function textFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? textFiles(path) : [path]
  })
}

describe("CLI generated project contract", () => {
  it("creates a real App Router project and preserves product-owned files on update", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saas-core-cli-"))
    created.push(directory)
    await runCli(["init", directory, "--yes", "--non-interactive"])
    const manifest = JSON.parse(readFileSync(join(directory, ".saas-core.json"), "utf8"))
    expect(manifest.coreVersion).toBe("1.1.2")
    expect(manifest.schemaVersion).toBe("1.3.1")
    expect(readFileSync(join(directory, "package.json"), "utf8")).toContain('"next": "16.3.0"')
    expect(readFileSync(join(directory, "proxy.ts"), "utf8")).toContain("createServerSupabaseClient")
    await runCli(["update", directory, "--dry-run"])
    expect(readFileSync(join(directory, "src/product/README.md"), "utf8")).toContain("Product-owned")
    await runCli(["diff", directory])
    await runCli(["test", directory])
  })

  it("keeps local packed-artifact paths out of every generated product file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saas-core-cli-portable-"))
    const artifactRoot = mkdtempSync(join(tmpdir(), "some-random-core-checkout-"))
    const artifactDirectory = join(artifactRoot, "artifacts")
    created.push(directory, artifactRoot)
    mkdirSync(artifactDirectory)
    const previous = process.env.SAAS_CORE_TARBALL_DIR
    process.env.SAAS_CORE_TARBALL_DIR = artifactDirectory
    try {
      await runCli(["init", directory, "--yes", "--non-interactive"])
    } finally {
      if (previous === undefined) delete process.env.SAAS_CORE_TARBALL_DIR
      else process.env.SAAS_CORE_TARBALL_DIR = previous
    }
    const generated = textFiles(directory).map((path) => readFileSync(path, "utf8")).join("\n")
    expect(generated).not.toContain(artifactDirectory)
    expect(generated).not.toMatch(/file:(?:\/|[A-Za-z]:[\\/])/i)
    const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
    expect(packageJson.pnpm).toBeUndefined()
    expect(packageJson.dependencies["@sapienx/saas-core"]).toBe("^1.1.2")
    expect(JSON.parse(readFileSync(join(directory, ".saas-core.json"), "utf8"))).not.toHaveProperty("SAAS_CORE_TARBALL_DIR")
  })

  it("derives product-facing identity from the supplied project name", async () => {
    const parent = mkdtempSync(join(tmpdir(), "saas-core-cli-branding-"))
    created.push(parent)
    for (const productName of ["Acme Cloud", "PlaceDJ", "Example Product"]) {
      const directory = join(parent, productName)
      await runCli(["init", directory, "--yes", "--non-interactive"])
      const auth = ["login", "signup", "forgot-password", "reset-password"].map((page) => readFileSync(join(directory, `src/app/(auth)/${page}/page.tsx`), "utf8"))
      for (const page of auth) {
        expect(page).toContain(productName)
        expect(page).not.toContain("SaaS Core application")
      }
      const onboarding = readFileSync(join(directory, "src/app/onboarding/page.tsx"), "utf8")
      expect(onboarding).toContain(productName)
      expect(onboarding).not.toContain("My product")
      expect(readFileSync(join(directory, "src/app/invite/[id]/page.tsx"), "utf8")).toContain(productName)
      expect(readFileSync(join(directory, "src/app/layout.tsx"), "utf8")).toContain(`title: ${JSON.stringify(productName)}`)
      expect(readFileSync(join(directory, "src/app/app/layout.tsx"), "utf8")).toContain(`productName={${JSON.stringify(productName)}}`)
      expect(readFileSync(join(directory, "core.config.ts"), "utf8")).toContain(`name: ${JSON.stringify(productName)}`)
      expect(readFileSync(join(directory, "src/app/api/invitations/route.ts"), "utf8")).toContain(`?? ${JSON.stringify(productName)}`)
    }
  })

  it("includes the domains provider package when custom domains are enabled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saas-core-cli-domains-"))
    created.push(directory)
    await runCli(["init", directory, "--yes", "--non-interactive", "--with-domains"])
    const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
    expect(packageJson.dependencies["@sapienx/saas-core-domains"]).toBeTruthy()
    expect(existsSync(join(directory, "src/app/api/platform/domains/[id]/reconcile/route.ts"))).toBe(true)
    expect(readFileSync(join(directory, "core.config.ts"), "utf8")).toContain("domains: { enabled: true }")
  })

  it("updates a v0.9 fixture with a checkpoint, migration addition, package merge, and conflict preservation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saas-core-cli-update-"))
    created.push(directory)
    await runCli(["init", directory, "--yes", "--non-interactive"])
    const manifestPath = join(directory, ".saas-core.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    manifest.coreVersion = "1.1.1"
    manifest.schemaVersion = "0.9"
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
    const pagePath = join(directory, "src/app/page.tsx")
    writeFileSync(pagePath, readFileSync(pagePath, "utf8") + "\n// product-owned customization\n")
    const packagePath = join(directory, "package.json")
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))
    for (const name of corePackages) packageJson.dependencies[name] = `file:${join(directory, "legacy-core-artifacts", `${name.replace(/^@/, "").replaceAll("/", "-")}-1.1.1.tgz`)}`
    packageJson.dependencies["product-local-dependency"] = "^4.2.0"
    packageJson.pnpm = { overrides: { ...Object.fromEntries(corePackages.map((name) => [name, `file:${join(directory, "legacy-core-artifacts", `${name.replace(/^@/, "").replaceAll("/", "-")}-1.1.1.tgz`)}`])), "product-local-dependency": "^4.2.0" } }
    writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n")
    const migrationPath = join(directory, "supabase/migrations/20260824020000_final_p0_hardening.sql")
    rmSync(migrationPath)
    const beforeDryRun = readFileSync(packagePath, "utf8")
    await runCli(["update", directory, "--dry-run"])
    expect(readFileSync(packagePath, "utf8")).toBe(beforeDryRun)
    await runCli(["update", directory])
    const updatedPackage = JSON.parse(readFileSync(packagePath, "utf8"))
    for (const name of corePackages) expect(updatedPackage.dependencies[name]).toBe("^1.1.2")
    expect(updatedPackage.pnpm).toEqual({ overrides: { "product-local-dependency": "^4.2.0" } })
    expect(updatedPackage.dependencies["product-local-dependency"]).toBe("^4.2.0")
    expect(readFileSync(pagePath, "utf8")).toContain("product-owned customization")
    expect(existsSync(migrationPath)).toBe(true)
    expect(readdirSync(join(directory, ".saas-core-backup")).length).toBeGreaterThan(0)
    const updated = JSON.parse(readFileSync(manifestPath, "utf8"))
    expect(updated.coreVersion).toBe("1.1.2")
    expect(updated.schemaVersion).toBe("1.3.1")
    expect(updated.managedFiles["supabase/migrations/20260824020000_final_p0_hardening.sql"]).toBeTruthy()
  })

  it("normalizes an affected v1.1.1 product and leaves it clean", async () => {
    const directory = mkdtempSync(join(tmpdir(), "saas-core-cli-v111-portable-"))
    created.push(directory)
    await runCli(["init", directory, "--yes", "--non-interactive"])
    const manifestPath = join(directory, ".saas-core.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    manifest.coreVersion = "1.1.1"
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
    const packagePath = join(directory, "package.json")
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))
    const legacyPath = join(directory, "legacy-core-checkout", "artifacts")
    packageJson.dependencies["@sapienx/saas-core"] = `file:${join(legacyPath, "sapienx-saas-core-1.1.1.tgz")}`
    packageJson.devDependencies = { ...packageJson.devDependencies, "@sapienx/saas-core-auth": `file:${join(legacyPath, "sapienx-saas-core-auth-1.1.1.tgz")}` }
    delete packageJson.dependencies["@sapienx/saas-core-auth"]
    packageJson.pnpm = { overrides: { "@sapienx/saas-core": `file:${join(legacyPath, "sapienx-saas-core-1.1.1.tgz")}`, "product-local-dependency": "^4.2.0" } }
    writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n")
    await runCli(["update", directory, "--dry-run"])
    await runCli(["update", directory])
    const updatedPackage = JSON.parse(readFileSync(packagePath, "utf8"))
    expect(updatedPackage.dependencies["@sapienx/saas-core"]).toBe("^1.1.2")
    expect(updatedPackage.dependencies["@sapienx/saas-core-auth"]).toBe("^1.1.2")
    expect(updatedPackage.devDependencies?.["@sapienx/saas-core-auth"]).toBeUndefined()
    expect(updatedPackage.pnpm).toEqual({ overrides: { "product-local-dependency": "^4.2.0" } })
    await runCli(["diff", directory])
    await runCli(["test", directory])
  })
})
