import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"
import { findSecretViolations, isLikelyTextFile, MAX_TEXT_SCAN_BYTES } from "./repo-hygiene.mjs"

const root = process.cwd()
const artifacts = path.join(root, "artifacts")
const packageDirectories = {
  "@sapienx/saas-core": "packages/core",
  "@sapienx/saas-core-config": "packages/config",
  "@sapienx/saas-core-ui": "packages/ui",
  "@sapienx/saas-core-app": "packages/app",
  "@sapienx/saas-core-cli": "packages/cli",
}
const forbiddenPathRules = [
  { pattern: /(?:^|\/)(?:\.git|\.github|\.env(?!\.example(?:\/|$))(?:\.|$)|\.npmrc|node_modules|\.next|\.temp|\.branches|\.turbo|\.cache)(?:\/|$)/, reason: "repository, local environment, or build state" },
  { pattern: /(?:^|\/)(?:coverage|playwright-report|test-results|output|artifacts|\.playwright-cli|local-registry|package-inspection|consumer-proof)(?:\/|$)/, reason: "test, browser, package, or registry runtime output" },
  { pattern: /(?:^|\/)(?:Users|private)\//, reason: "machine-local absolute path" },
  { pattern: /(?:^|\/)[^/]+\.(?:tgz|log|pid|sqlite|sqlite3|db|dump|sql\.gz)$/i, reason: "local artifact, log, or database file" },
  { pattern: /(?:^|\/)(?:screenshots?|traces?|videos?)(?:\/|$)/i, reason: "browser evidence output" },
]
const forbiddenContent = /(?:workspace:|file:|link:|registry\.url|localhost:\d+|\/Users\/|\/private\/)/
const intentionalTestFiles = new Set([
  "package/template/i18n/config.test.ts",
  "package/template/test/server-only-shim.ts",
])
const sourceMapPackages = new Set(["@sapienx/saas-core", "@sapienx/saas-core-config", "@sapienx/saas-core-ui"])

function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(absolute))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

function inspectPackagedSecrets(filename, tarball) {
  const extractionRoot = mkdtempSync(path.join(os.tmpdir(), "saas-core-package-audit-"))
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", extractionRoot])
    const packageRoot = path.join(extractionRoot, "package")
    for (const absolute of listFiles(packageRoot)) {
      const relative = path.relative(packageRoot, absolute).split(path.sep).join("/")
      const stats = lstatSync(absolute)
      if (stats.size > MAX_TEXT_SCAN_BYTES || !isLikelyTextFile(relative)) continue
      const bytes = readFileSync(absolute)
      if (bytes.includes(0)) continue
      const violations = findSecretViolations(relative, bytes.toString("utf8"))
      if (violations.length) throw new Error(`${filename} contains ${violations[0].reason}: package/${relative}`)
    }
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true })
  }
}

for (const packageName of PACKAGE_NAMES) {
  const directory = packageDirectories[packageName]
  const dryRun = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: path.join(root, directory), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (dryRun.status !== 0) throw new Error(`npm pack --dry-run failed for ${packageName}: ${dryRun.stderr || dryRun.stdout}`)

  const filename = `${packageName.replace(/^@/, "").replace("/", "-")}-${RELEASE_VERSION}.tgz`
  const tarball = path.join(artifacts, filename)
  if (!existsSync(tarball)) throw new Error(`Missing packed artifact ${filename}. Run pnpm core:pack first.`)
  const packageJson = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }))
  if (packageJson.name !== packageName || packageJson.version !== RELEASE_VERSION) throw new Error(`${filename} has incorrect package identity.`)
  if (packageJson.private === true) throw new Error(`${filename} is marked private.`)
  const dependencyValues = Object.values({ ...packageJson.dependencies, ...packageJson.devDependencies, ...packageJson.optionalDependencies, ...packageJson.peerDependencies })
  if (dependencyValues.some((value) => typeof value === "string" && forbiddenContent.test(value))) throw new Error(`${filename} contains a local/workspace dependency reference.`)
  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean)
  inspectPackagedSecrets(filename, tarball)
  for (const { pattern, reason } of forbiddenPathRules) {
    const offending = listing.find((entry) => pattern.test(entry))
    if (offending) throw new Error(`${filename} contains ${reason}: ${offending}`)
  }
  const files = listing.filter((entry) => entry.startsWith("package/")).map((entry) => entry.slice("package/".length))
  if (!files.includes("package.json") || !files.includes("README.md")) throw new Error(`${filename} is missing package metadata.`)
  const packagedTests = files.filter((relative) => /(?:^|\/)(?:test|tests|e2e)(?:\/|$)|\.test\.(?:c|m)?[jt]sx?$/.test(relative))
  const unexpectedTests = packagedTests.filter((relative) => !intentionalTestFiles.has(`package/${relative}`))
  if (unexpectedTests.length) throw new Error(`${filename} contains unapproved test files: ${unexpectedTests.join(", ")}`)
  const sourceMaps = files.filter((relative) => relative.endsWith(".map"))
  if (sourceMaps.length && !sourceMapPackages.has(packageName)) throw new Error(`${filename} contains source maps outside the explicit package source-map allowlist: ${sourceMaps.join(", ")}`)
  if (forbiddenContent.test(JSON.stringify(packageJson))) throw new Error(`${filename} contains a local path, registry URL, or workspace protocol.`)
}

const coreTarball = path.join(artifacts, `sapienx-saas-core-${RELEASE_VERSION}.tgz`)
const coreDeclarations = execFileSync("tar", ["-xOf", coreTarball, "package/dist/index.d.ts"], { encoding: "utf8" })
const coreRuntime = execFileSync("tar", ["-xOf", coreTarball, "package/dist/index.js"], { encoding: "utf8" })
const coreEntitlementDeclarations = execFileSync("tar", ["-xOf", coreTarball, "package/dist/entitlements.d.ts"], { encoding: "utf8" })
for (const name of ["PlanDefinition", "validatePlanDefinition", "normalizeProductPlan", "classifyProductPlanChange", "duplicateProductPlan"]) {
  if (!coreDeclarations.includes(name)) throw new Error(`Core artifact is missing the plan catalog contract: ${name}.`)
}
for (const name of ["evaluateEntitlementConsumption", "getUsageSnapshot", "getEntitlementGateState"]) {
  if (!coreRuntime.includes(`export * from \"./entitlements.js\"`) || !coreEntitlementDeclarations.includes(`function ${name}`)) throw new Error(`Core artifact is missing the entitlement API: ${name}.`)
}
for (const name of ["EntitlementErrorCode", "EntitlementLimit"]) {
  if (!coreEntitlementDeclarations.includes(`type ${name}`)) throw new Error(`Core artifact is missing the entitlement type: ${name}.`)
}
const planCatalogDoc = execFileSync("tar", ["-xOf", coreTarball, "package/docs/PLAN-CATALOG.md"], { encoding: "utf8" })
if (planCatalogDoc !== readFileSync(path.join(root, "docs/PLAN-CATALOG.md"), "utf8")) throw new Error("Core artifact contains a stale or incomplete Plan Catalog guide.")

const managedPlanFiles = [
  "package/template/supabase/migrations/20260914100000_reusable_plan_catalog_management.sql",
  "package/template/supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql",
  "package/template/supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql",
  "package/template/supabase/migrations/20260915090000_fix_invalid_scheduled_downgrade_fail_closed.sql",
  "package/template/supabase/migrations/20260830150000_saas_core_platform_user_guards.sql",
  "package/template/src/product/usage.ts",
  "package/template/app/platform/billing/actions.ts",
  "package/template/app/platform/billing/page.tsx",
  "package/template/components/platform/platform-plan-management.tsx",
]
for (const packageName of ["@sapienx/saas-core-app", "@sapienx/saas-core-cli"]) {
  const filename = `${packageName.replace(/^@/, "").replace("/", "-")}-${RELEASE_VERSION}.tgz`
  const listing = execFileSync("tar", ["-tzf", path.join(artifacts, filename)], { encoding: "utf8" })
  for (const relative of managedPlanFiles) if (!listing.includes(`${relative}\n`)) throw new Error(`${filename} is missing managed plan file ${relative}.`)
  if (!listing.includes("package/template/.env.example\n") || !listing.includes("package/template/README.md\n") || !listing.includes("package/template/AGENTS.md\n") || !listing.includes("package/template/consumer.gitignore\n")) throw new Error(`${filename} is missing the generated consumer contract templates.`)
}

const configTarball = path.join(artifacts, `sapienx-saas-core-config-${RELEASE_VERSION}.tgz`)
const configPackage = JSON.parse(execFileSync("tar", ["-xOf", configTarball, "package/package.json"], { encoding: "utf8" }))
if (configPackage.dependencies?.["@sapienx/saas-core"] !== `^${RELEASE_VERSION}`) throw new Error("Config tarball did not resolve its Core workspace dependency to the registry range.")

console.log(JSON.stringify({ status: "PASS", packages: PACKAGE_NAMES, version: RELEASE_VERSION, artifacts }))
