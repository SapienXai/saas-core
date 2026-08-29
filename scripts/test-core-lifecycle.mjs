import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const root = process.cwd()
const cli = path.join(root, "packages/cli/bin/saas-core.mjs")
const source = path.join(root, "packages/app/template")
const fixture = await fsTemp("saas-core-lifecycle-")
const coreA = path.join(fixture, "core-a")
const coreB = path.join(fixture, "core-b")
const cleanProduct = path.join(fixture, "clean-product")
const conflictProduct = path.join(fixture, "conflict-product")
const rollbackProduct = path.join(fixture, "rollback-product")
const legacyProduct = path.join(fixture, "legacy-product")
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
  await writeFile(path.join(cleanProduct, "product.catalog.json"), JSON.stringify({ defaultPlanKey: "hobby", plans: [{ key: "hobby", name: "Hobby", prices: { month: { amount: 7, currency: "EUR" } }, limits: { "core.workspaces": 2 } }], usageMetrics: [{ key: "projects", name: "Projects" }] }, null, 2) + "\n", "utf8")
  const cleanPackage = JSON.parse(await readFile(path.join(cleanProduct, "package.json"), "utf8"))
  cleanPackage.dependencies["@sapienx/saas-core-ui"] = "^1.0.0"
  await writeFile(path.join(cleanProduct, "package.json"), JSON.stringify(cleanPackage, null, 2) + "\n", "utf8")
  result = run(coreB, ["update", cleanProduct, "--dry-run", "--json"])
  assert(result.status === 0, result.stderr || "dry-run failed")
  const dryRun = JSON.parse(result.stdout)
  assert(dryRun.updated.includes("app/error.tsx") && dryRun.updated.includes("package.json") && dryRun.added.includes("app/core-lifecycle-fixture.ts") && dryRun.removed.includes("app/robots.ts"), "dry-run did not report changed/added/removed managed files and package drift")
  result = run(coreB, ["update", cleanProduct, "--json"])
  assert(result.status === 0, `${result.stderr || result.stdout || "clean update failed"}`)
  const cleanReport = JSON.parse(result.stdout)
  assert(cleanReport.backup && existsSync(cleanReport.backup), "clean update did not create a backup")
  assert(JSON.stringify(cleanReport.updated) === JSON.stringify(dryRun.updated) && JSON.stringify(cleanReport.added) === JSON.stringify(dryRun.added) && JSON.stringify(cleanReport.removed) === JSON.stringify(dryRun.removed), "dry-run plan did not match the real update plan")
  assert((await readFile(path.join(cleanProduct, "app/page.tsx"), "utf8")).includes("product-owned customization"), "product customization was overwritten")
  result = run(coreB, ["doctor", cleanProduct, "--json"])
  assert(result.status === 0, result.stderr || "post-update doctor failed")

  result = run(coreA, ["init", "Lifecycle Conflict", conflictProduct])
  assert(result.status === 0, result.stderr || "conflict init failed")
  const conflictFile = path.join(conflictProduct, "app/error.tsx")
  const conflictRobotsBefore = await readFile(path.join(conflictProduct, "app/robots.ts"), "utf8")
  const conflictPackageBefore = await readFile(path.join(conflictProduct, "package.json"), "utf8")
  const conflictManifestBefore = await readFile(path.join(conflictProduct, ".saas-core-manifest.json"), "utf8")
  const localContent = `${await readFile(conflictFile, "utf8")}\n// local managed modification\n`
  await writeFile(conflictFile, localContent, "utf8")
  result = run(coreB, ["update", conflictProduct, "--json"])
  assert(result.status === 2, "managed modification did not produce an update conflict")
  const conflictReport = JSON.parse(result.stdout)
  assert(conflictReport.conflicts.includes("app/error.tsx"), "conflict report omitted modified managed file")
  assert((await readFile(conflictFile, "utf8")) === localContent, "conflicting managed file was overwritten")
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
  result = run(coreA, ["doctor", rollbackProduct, "--json"])
  assert(result.status === 0, result.stderr || "doctor rejected the consumer after rollback")

  console.log(JSON.stringify({ status: "PASS", localSource: true, cleanUpdate: true, dryRunMatchesApply: true, backup: true, conflictPreserved: true, conflictDidNotMutateOthers: true, productOwnedPreserved: true, rollback: true, rollbackDoctor: true }))
} finally {
  await rm(fixture, { recursive: true, force: true })
}
