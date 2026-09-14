import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { RELEASE_VERSION, RUNTIME_PACKAGES, SCHEMA_VERSION, TOOLING_PACKAGES } from "./release-constants.mjs"

const root = process.cwd()
const cli = path.join(root, "packages/cli/bin/saas-core.mjs")
const source = path.join(root, "packages/app/template")
const LEGACY_VERSION = "2.1.0"
const billingMigrations = [
  "supabase/migrations/20260909094344_reusable_billing_persistence.sql",
  "supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql",
  "supabase/migrations/20260914100000_reusable_plan_catalog_management.sql",
]
const runtimePackages = RUNTIME_PACKAGES
const toolingPackages = TOOLING_PACKAGES
const fixture = await fsTemp("saas-core-lifecycle-")
const coreA = path.join(fixture, "core-a")
const coreB = path.join(fixture, "core-b")
const coreC = path.join(fixture, "core-c")
const cleanProduct = path.join(fixture, "clean-product")
const conflictProduct = path.join(fixture, "conflict-product")
const rollbackProduct = path.join(fixture, "rollback-product")
const legacyProduct = path.join(fixture, "legacy-product")
const agentSurfaceProduct = path.join(fixture, "agent-surface-product")
const localSourceProduct = path.join(fixture, "local-source-product")
const gitSourceRepository = path.join(fixture, "git-source-repository")

async function fsTemp(prefix) {
  const directory = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), prefix)))
  return directory
}

function run(template, args, extraEnvironment = {}) {
  const environment = { ...process.env, ...extraEnvironment }
  if (template) environment.SAAS_CORE_TEMPLATE = template
  else delete environment.SAAS_CORE_TEMPLATE
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: environment, encoding: "utf8" })
  return result
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" })
  assert(result.status === 0, result.stderr || `git ${args.join(" ")} failed`)
  return result.stdout.trim()
}

try {
  await cp(source, coreA, { recursive: true })
  await cp(coreA, coreB, { recursive: true })
  const changedManaged = path.join(coreB, "app/error.tsx")
  await writeFile(changedManaged, `${await readFile(changedManaged, "utf8")}\n// Synthetic Core B change.\n`, "utf8")
  await writeFile(path.join(coreB, "app/core-lifecycle-fixture.ts"), "export const lifecycleFixture = true\n", "utf8")
  await rm(path.join(coreB, "app/robots.ts"))
  await cp(coreB, coreC, { recursive: true })
  const agentSurfaceFiles = [
    "components/agent-surface/core-webmcp-tools.tsx",
    "lib/agent-surface/server.ts",
    "lib/agent-surface/webmcp.ts",
  ]
  const billingManagedFiles = [
    ...billingMigrations,
    "app/api/billing/paddle/webhook/route.ts",
    "app/api/cron/billing/lifecycle/route.ts",
    "app/manage/plan/actions.ts",
    "app/manage/plan/page.tsx",
    "app/platform/billing/page.tsx",
    "components/manage/billing-success-experience.tsx",
    "components/manage/paddle-billing-actions.tsx",
    "components/manage/plan-feature-preview.tsx",
    "components/manage/scheduled-plan-change-banner.tsx",
    "lib/billing/lifecycle.ts",
    "lib/billing/paddle-client.ts",
    "lib/billing/persistence.ts",
    "lib/billing/price-mapping.ts",
    "lib/billing/reconciliation.ts",
    "lib/billing/webhook.ts",
    "lib/entitlements.ts",
  ]
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) await rm(path.join(coreA, relative), { force: true })
  await writeFile(path.join(coreC, "lib/agent-surface/webmcp.ts"), `${await readFile(path.join(coreC, "lib/agent-surface/webmcp.ts"), "utf8")}\n// Synthetic Core C change.\n`, "utf8")

  await mkdir(path.join(gitSourceRepository, "packages/app"), { recursive: true })
  await cp(coreB, path.join(gitSourceRepository, "packages/app/template"), { recursive: true })
  git(gitSourceRepository, ["init", "-q"])
  git(gitSourceRepository, ["add", "."])
  git(gitSourceRepository, ["-c", "user.name=SaaS Core Lifecycle", "-c", "user.email=core-lifecycle@example.test", "commit", "-qm", "fixture Core source"])
  const gitSourceCommit = git(gitSourceRepository, ["rev-parse", "HEAD"])

  // A repository root can be supplied as a local development source. The
  // source flag must select the canonical template while preserving the
  // consumer's product-owned theme file.
  let result = run(null, ["init", "Local Source Consumer", localSourceProduct, "--source", root])
  assert(result.status === 0, result.stderr || "local source init failed")
  const initializedLocalManifest = JSON.parse(await readFile(path.join(localSourceProduct, ".saas-core-manifest.json"), "utf8"))
  assert(initializedLocalManifest.coreSourceCommit === git(root, ["rev-parse", "HEAD"]), "local source init did not record the Core Git SHA")
  const localThemeFile = path.join(localSourceProduct, "styles/product-theme.css")
  const localTheme = `${await readFile(localThemeFile, "utf8")}\n:root { --placedj-test-token: #123456; }\n`
  await writeFile(localThemeFile, localTheme, "utf8")
  result = run(coreA, ["update", localSourceProduct, "--source", coreB, "--dry-run", "--json"])
  assert(result.status === 0, result.stderr || "local source dry-run failed")
  const localDryRun = JSON.parse(result.stdout)
  assert(localDryRun.updated.includes("app/error.tsx") && !localDryRun.updated.includes("styles/product-theme.css"), "local source dry-run did not preserve the product-owned theme")
  result = run(coreA, ["update", localSourceProduct, "--source", coreB, "--json"])
  assert(result.status === 0, result.stderr || result.stdout || "local source update failed")
  assert((await readFile(localThemeFile, "utf8")) === localTheme, "local source update overwrote the product-owned theme")
  result = run(coreA, ["update", localSourceProduct, "--source", gitSourceRepository, "--dry-run", "--json"])
  assert(result.status === 0, result.stderr || "Git source provenance dry-run failed")
  const provenanceDryRun = JSON.parse(result.stdout)
  assert(provenanceDryRun.manifestChanged === true && provenanceDryRun.provenance === gitSourceCommit, "Git source provenance was not planned")
  result = run(coreA, ["update", localSourceProduct, "--source", gitSourceRepository, "--json"])
  assert(result.status === 0, result.stderr || result.stdout || "Git source provenance update failed")
  const updatedLocalManifest = JSON.parse(await readFile(path.join(localSourceProduct, ".saas-core-manifest.json"), "utf8"))
  assert(updatedLocalManifest.coreSourceCommit === gitSourceCommit, "local source update did not record the Core Git SHA")
  result = run(coreB, ["doctor", localSourceProduct, "--json"])
  assert(result.status === 0, result.stderr || "local source post-update doctor failed")

  // An existing consumer from before Agent Surface must receive only the new
  // managed files; its product-owned theme remains byte-for-byte unchanged.
  result = run(coreA, ["init", "Agent Surface Consumer", agentSurfaceProduct])
  assert(result.status === 0, result.stderr || "Agent Surface fixture init failed")
  const agentThemeFile = path.join(agentSurfaceProduct, "styles/product-theme.css")
  const agentTheme = `${await readFile(agentThemeFile, "utf8")}\n:root { --agent-surface-test-token: #123456; }\n`
  await writeFile(agentThemeFile, agentTheme, "utf8")
  const agentProductFiles = ["styles/product-theme.css", "lib/product-config.ts", "product.catalog.json", "src/product/domain.ts"]
  const agentProductBefore = Object.fromEntries(await Promise.all(agentProductFiles.map(async (relative) => [relative, await readFile(path.join(agentSurfaceProduct, relative), "utf8")])))
  const legacyPackageFile = path.join(agentSurfaceProduct, "package.json")
  const legacyPackage = JSON.parse(await readFile(legacyPackageFile, "utf8"))
  for (const name of runtimePackages) legacyPackage.dependencies[name] = `^${LEGACY_VERSION}`
  for (const name of toolingPackages) legacyPackage.devDependencies[name] = `^${LEGACY_VERSION}`
  await writeFile(legacyPackageFile, JSON.stringify(legacyPackage, null, 2) + "\n", "utf8")
  const legacyManifestFile = path.join(agentSurfaceProduct, ".saas-core-manifest.json")
  const agentLegacyManifest = JSON.parse(await readFile(legacyManifestFile, "utf8"))
  agentLegacyManifest.coreVersion = LEGACY_VERSION
  agentLegacyManifest.templateVersion = LEGACY_VERSION
  agentLegacyManifest.schemaVersion = SCHEMA_VERSION
  agentLegacyManifest.packageVersions = Object.fromEntries([...runtimePackages, ...toolingPackages].map((name) => [name, `^${LEGACY_VERSION}`]))
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) {
    await rm(path.join(agentSurfaceProduct, relative), { force: true })
    delete agentLegacyManifest.managedFiles[relative]
  }
  await writeFile(legacyManifestFile, JSON.stringify(agentLegacyManifest, null, 2) + "\n", "utf8")
  result = run(coreB, ["diff", agentSurfaceProduct, "--json"])
  assert(result.status === 2, `${result.stderr || result.stdout || "Agent Surface version diff did not report expected drift"}`)
  const agentDiff = JSON.parse(result.stdout)
  assert(agentDiff.versionDrift.includes(`Core version ${LEGACY_VERSION} → ${RELEASE_VERSION}`), "Agent Surface diff did not report the runtime upgrade")
  assert(agentDiff.schemaDrift.length === 0 && agentDiff.versionDrift.every((item) => !item.includes("Schema")), "Agent Surface version upgrade incorrectly changed the schema")
  assert(agentDiff.packageDrift.length === 4 && agentDiff.packageDrift.every((item) => item.actual === `^${LEGACY_VERSION}` && item.expected === `^${RELEASE_VERSION}`), "Agent Surface diff did not report all package movements")
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) assert(agentDiff.coreDrift.includes(`A ${relative}`), `Agent Surface diff omitted managed billing/surface addition ${relative}`)
  assert(agentDiff.coreDrift.every((item) => !agentProductFiles.some((relative) => item.endsWith(` ${relative}`))), "Agent Surface diff proposed product-owned changes")
  result = run(coreB, ["update", agentSurfaceProduct, "--dry-run", "--json"])
  assert(result.status === 0, result.stderr || "Agent Surface fixture dry-run failed")
  const agentDryRun = JSON.parse(result.stdout)
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) assert(agentDryRun.added.includes(relative), `Managed billing/surface dry-run omitted ${relative}`)
  assert(agentDryRun.updated.includes("package.json"), "Agent Surface dry-run omitted the package version movement")
  result = run(coreB, ["update", agentSurfaceProduct, "--json"])
  assert(result.status === 0, result.stderr || result.stdout || "Agent Surface fixture update failed")
  const agentApply = JSON.parse(result.stdout)
  assert(JSON.stringify(agentApply.updated) === JSON.stringify(agentDryRun.updated) && JSON.stringify(agentApply.added) === JSON.stringify(agentDryRun.added) && JSON.stringify(agentApply.removed) === JSON.stringify(agentDryRun.removed), "Agent Surface dry-run plan did not match the real update plan")
  assert((await readFile(agentThemeFile, "utf8")) === agentTheme, "Agent Surface update overwrote the product-owned theme")
  for (const relative of agentProductFiles) assert((await readFile(path.join(agentSurfaceProduct, relative), "utf8")) === agentProductBefore[relative], `Agent Surface update changed product-owned file ${relative}`)
  for (const relative of [...agentSurfaceFiles, ...billingManagedFiles]) assert(existsSync(path.join(agentSurfaceProduct, relative)), `Managed billing/surface update did not add ${relative}`)
  const upgradedAgentPackage = JSON.parse(await readFile(legacyPackageFile, "utf8"))
  for (const name of runtimePackages) assert(upgradedAgentPackage.dependencies[name] === `^${RELEASE_VERSION}`, `Agent Surface update did not advance ${name}`)
  for (const name of toolingPackages) assert(upgradedAgentPackage.devDependencies[name] === `^${RELEASE_VERSION}`, `Agent Surface update did not advance ${name}`)
  const upgradedAgentManifest = JSON.parse(await readFile(legacyManifestFile, "utf8"))
  assert(upgradedAgentManifest.coreVersion === RELEASE_VERSION && upgradedAgentManifest.templateVersion === RELEASE_VERSION, "Agent Surface update did not advance manifest runtime metadata")
  assert(upgradedAgentManifest.schemaVersion === SCHEMA_VERSION, "Agent Surface update changed the schema version")
  assert(Object.values(upgradedAgentManifest.packageVersions).every((value) => value === `^${RELEASE_VERSION}`), "Agent Surface update did not record the new package versions")
  const agentConflictFile = path.join(agentSurfaceProduct, "lib/agent-surface/webmcp.ts")
  const agentConflictContent = `${await readFile(agentConflictFile, "utf8")}\n// local managed modification\n`
  await writeFile(agentConflictFile, agentConflictContent, "utf8")
  result = run(coreC, ["update", agentSurfaceProduct, "--json"])
  assert(result.status === 2, "modified Agent Surface managed file did not produce an update conflict")
  const agentConflictReport = JSON.parse(result.stdout)
  assert(agentConflictReport.conflicts.includes("lib/agent-surface/webmcp.ts"), "Agent Surface conflict report omitted the modified file")
  assert((await readFile(agentConflictFile, "utf8")) === agentConflictContent, "Agent Surface conflict overwrote the local modification")

  // Simulate a consumer generated before the product shell contract existed.
  // Its product-owned config must survive the update byte-for-byte while the
  // new managed resolver is added from the canonical template.
  await rm(path.join(coreA, "lib/product-shell.ts"))
  result = run(coreA, ["init", "Legacy Shell Consumer", legacyProduct])
  assert(result.status === 0, result.stderr || "legacy init failed")
  const legacyConfigFile = path.join(legacyProduct, "lib/product-config.ts")
  const legacyConfig = (await readFile(legacyConfigFile, "utf8"))
    .replace(/export type ProductShellNavigationItem = \{[\s\S]*?\n\}\n\nexport type ProductShellConfig = \{[\s\S]*?\n\}\n\n/, "")
    .replace("  shell?: ProductShellConfig\n", "")
  await writeFile(legacyConfigFile, legacyConfig, "utf8")
  const legacyConfigBeforeUpdate = await readFile(legacyConfigFile, "utf8")
  result = run(coreB, ["update", legacyProduct, "--json"])
  assert(result.status === 0, result.stderr || result.stdout || "legacy consumer update failed")
  assert(existsSync(path.join(legacyProduct, "lib/product-shell.ts")), "legacy update did not add the product shell resolver")
  assert((await readFile(legacyConfigFile, "utf8")) === legacyConfigBeforeUpdate, "legacy product config was overwritten during update")
  const legacyManifest = JSON.parse(await readFile(path.join(legacyProduct, ".saas-core-manifest.json"), "utf8"))
  assert(legacyManifest.productOwnedPaths.includes("styles/product-theme.css"), "legacy update did not record the product theme boundary")
  result = run(coreB, ["doctor", legacyProduct, "--json"])
  assert(result.status === 0, result.stderr || "legacy consumer doctor failed")

  result = run(coreA, ["init", "Lifecycle Clean", cleanProduct])
  assert(result.status === 0, result.stderr || "clean init failed")
  await writeFile(path.join(cleanProduct, "app/page.tsx"), `${await readFile(path.join(cleanProduct, "app/page.tsx"), "utf8")}\n// product-owned customization\n`, "utf8")
  const productMigrationRelative = "supabase/migrations/product/20990909000000_product-owned-proof.sql"
  const productMigrationFile = path.join(cleanProduct, productMigrationRelative)
  await mkdir(path.dirname(productMigrationFile), { recursive: true })
  const productMigrationContent = "-- Product-owned migration fixture\ncreate table if not exists public.product_owned_proof (id uuid primary key);\n"
  await writeFile(productMigrationFile, productMigrationContent, "utf8")
  await writeFile(path.join(cleanProduct, "product.catalog.json"), JSON.stringify({ defaultPlanKey: "hobby", plans: [{ key: "hobby", name: "Hobby", prices: { month: { amount: 7, currency: "EUR" } }, limits: { "core.workspaces": 2 } }], usageMetrics: [{ key: "projects", name: "Projects" }] }, null, 2) + "\n", "utf8")
  const cleanPackage = JSON.parse(await readFile(path.join(cleanProduct, "package.json"), "utf8"))
  cleanPackage.dependencies["@sapienx/saas-core-ui"] = "^1.0.0"
  await writeFile(path.join(cleanProduct, "package.json"), JSON.stringify(cleanPackage, null, 2) + "\n", "utf8")
  result = run(coreB, ["update", cleanProduct, "--dry-run", "--json"])
  assert(result.status === 0, result.stderr || "dry-run failed")
  const dryRun = JSON.parse(result.stdout)
  assert(dryRun.updated.includes("app/error.tsx") && dryRun.updated.includes("package.json") && dryRun.added.includes("app/core-lifecycle-fixture.ts") && billingMigrations.every((migration) => dryRun.added.includes(migration)) && dryRun.removed.includes("app/robots.ts"), "dry-run did not report changed/added/removed managed files, billing migrations, and package drift")
  result = run(coreB, ["update", cleanProduct, "--json"])
  assert(result.status === 0, `${result.stderr || result.stdout || "clean update failed"}`)
  const cleanReport = JSON.parse(result.stdout)
  assert(cleanReport.backup && existsSync(cleanReport.backup), "clean update did not create a backup")
  assert(JSON.stringify(cleanReport.updated) === JSON.stringify(dryRun.updated) && JSON.stringify(cleanReport.added) === JSON.stringify(dryRun.added) && JSON.stringify(cleanReport.removed) === JSON.stringify(dryRun.removed), "dry-run plan did not match the real update plan")
  assert((await readFile(path.join(cleanProduct, "app/page.tsx"), "utf8")).includes("product-owned customization"), "product customization was overwritten")
  assert((await readFile(productMigrationFile, "utf8")) === productMigrationContent, "update changed a product-owned migration")
  result = run(coreB, ["doctor", cleanProduct, "--json"])
  assert(result.status === 0, result.stderr || "post-update doctor failed")

  result = run(coreA, ["init", "Lifecycle Conflict", conflictProduct])
  assert(result.status === 0, result.stderr || "conflict init failed")
  const conflictFile = path.join(conflictProduct, "app/error.tsx")
  const conflictMigrationFile = path.join(conflictProduct, billingMigrations[0])
  await mkdir(path.dirname(conflictMigrationFile), { recursive: true })
  const conflictMigrationContent = "-- locally supplied migration with the same Core path\n"
  await writeFile(conflictMigrationFile, conflictMigrationContent, "utf8")
  const conflictRobotsBefore = await readFile(path.join(conflictProduct, "app/robots.ts"), "utf8")
  const conflictPackageBefore = await readFile(path.join(conflictProduct, "package.json"), "utf8")
  const conflictManifestBefore = await readFile(path.join(conflictProduct, ".saas-core-manifest.json"), "utf8")
  const localContent = `${await readFile(conflictFile, "utf8")}\n// local managed modification\n`
  await writeFile(conflictFile, localContent, "utf8")
  result = run(coreB, ["update", conflictProduct, "--json"])
  assert(result.status === 2, "managed modification did not produce an update conflict")
  const conflictReport = JSON.parse(result.stdout)
  assert(conflictReport.conflicts.includes("app/error.tsx"), "conflict report omitted modified managed file")
  assert(conflictReport.conflicts.includes(billingMigrations[0]), "conflict report omitted same-path Core migration")
  assert((await readFile(conflictFile, "utf8")) === localContent, "conflicting managed file was overwritten")
  assert((await readFile(conflictMigrationFile, "utf8")) === conflictMigrationContent, "same-path Core migration conflict was overwritten")
  assert((await readFile(path.join(conflictProduct, "app/robots.ts"), "utf8")) === conflictRobotsBefore, "conflict update partially removed an unrelated managed file")
  assert((await readFile(path.join(conflictProduct, "package.json"), "utf8")) === conflictPackageBefore, "conflict update partially changed package.json")
  assert((await readFile(path.join(conflictProduct, ".saas-core-manifest.json"), "utf8")) === conflictManifestBefore, "conflict update partially changed the manifest")

  result = run(coreA, ["init", "Lifecycle Rollback", rollbackProduct])
  assert(result.status === 0, result.stderr || "rollback init failed")
  const rollbackErrorBefore = await readFile(path.join(rollbackProduct, "app/error.tsx"), "utf8")
  const rollbackPackageBefore = await readFile(path.join(rollbackProduct, "package.json"), "utf8")
  const rollbackManifestBefore = await readFile(path.join(rollbackProduct, ".saas-core-manifest.json"), "utf8")
  result = run(coreB, ["update", rollbackProduct, "--json"], { SAAS_CORE_TEST_FAIL_AFTER_MUTATION: "1" })
  assert(result.status === 2, "injected update failure did not fail the update")
  const rollbackReport = JSON.parse(result.stdout)
  assert(rollbackReport.rollback === "succeeded", "failed update did not report a successful rollback")
  assert(rollbackReport.backup && existsSync(rollbackReport.backup), "failed update did not preserve a complete backup")
  assert((await readFile(path.join(rollbackProduct, "app/error.tsx"), "utf8")) === rollbackErrorBefore, "rollback did not restore the managed file")
  assert((await readFile(path.join(rollbackProduct, "package.json"), "utf8")) === rollbackPackageBefore, "rollback did not restore package.json")
  assert((await readFile(path.join(rollbackProduct, ".saas-core-manifest.json"), "utf8")) === rollbackManifestBefore, "rollback did not restore the manifest")
  assert(!existsSync(path.join(rollbackProduct, "app/core-lifecycle-fixture.ts")), "rollback left a newly added Core file behind")
  assert(billingMigrations.every((migration) => !existsSync(path.join(rollbackProduct, migration))), "rollback left a newly added reusable billing migration behind")
  result = run(coreA, ["doctor", rollbackProduct, "--json"])
  assert(result.status !== 0 && result.stdout.includes("Required reusable billing migration source is missing"), "doctor did not expose the missing migration source after rollback")

  console.log(JSON.stringify({ status: "PASS", localSource: true, cleanUpdate: true, dryRunMatchesApply: true, backup: true, conflictPreserved: true, conflictDidNotMutateOthers: true, productOwnedPreserved: true, agentSurfaceUpdate: true, billingManagedUpdate: true, agentSurfaceVersionUpgrade: `${LEGACY_VERSION} -> ${RELEASE_VERSION}`, agentSurfacePackageMovement: true, agentSurfaceSchemaUnchanged: SCHEMA_VERSION, agentSurfaceConflict: true, rollback: true, rollbackDoctor: true }))
} finally {
  await rm(fixture, { recursive: true, force: true })
}
