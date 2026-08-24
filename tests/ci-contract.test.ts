import { join } from "node:path"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8")

describe("GitHub Actions acceptance contracts", () => {
  it("loads Supabase credentials before generating and building the generated app", () => {
    const job = workflow.slice(workflow.indexOf("  generated-app-e2e:"), workflow.indexOf("  core-lab-e2e:"))
    const status = job.indexOf('eval "$(supabase status -o env)"')
    const init = job.indexOf("node packages/core/dist/cli.js init")
    const envFile = job.indexOf('> "$temp_dir/app/.env.local"')
    const install = job.indexOf('pnpm --dir "$temp_dir/app" install')
    const build = job.indexOf('pnpm --dir "$temp_dir/app" build')
    const start = job.indexOf('next dev --port 4321')

    expect(status).toBeGreaterThanOrEqual(0)
    expect(init).toBeGreaterThan(status)
    expect(envFile).toBeGreaterThan(init)
    expect(install).toBeGreaterThan(envFile)
    expect(build).toBeGreaterThan(install)
    expect(start).toBeGreaterThan(build)
  })

  it("does not advertise an echo-only invitation acceptance gate", () => {
    expect(workflow).not.toContain("invitation-e2e:")
    expect(workflow).not.toContain("Invitation signup, wrong-account protection")
  })

  it("keeps the authoritative release verification job in CI", () => {
    expect(workflow).toContain("  release-verify:")
    expect(workflow).toContain("pnpm release:verify")
  })
})
