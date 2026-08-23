import { mkdtempSync, readFileSync, rmSync } from "node:fs"
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
    expect(manifest.coreVersion).toBe("1.0.0")
    expect(manifest.schemaVersion).toBe("1.1-hardening")
    expect(readFileSync(join(directory, "package.json"), "utf8")).toContain('"next": "16.3.0"')
    expect(readFileSync(join(directory, "proxy.ts"), "utf8")).toContain("createServerSupabaseClient")
    await runCli(["update", directory, "--dry-run"])
    expect(readFileSync(join(directory, "src/product/README.md"), "utf8")).toContain("Product-owned")
  })
})
