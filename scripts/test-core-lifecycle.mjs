import { cp, readFile, rm, writeFile } from "node:fs/promises"
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

async function fsTemp(prefix) {
  const directory = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), prefix)))
  return directory
}

function run(template, args, extraEnvironment = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, SAAS_CORE_TEMPLATE: template, ...extraEnvironment }, encoding: "utf8" })
  return result
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  await cp(source, coreA, { recursive: true })
  await cp(coreA, coreB, { recursive: true })
  const changedManaged = path.join(coreB, "app/error.tsx")
  await writeFile(changedManaged, `${await readFile(changedManaged, "utf8")}\n// Synthetic Core B change.\n`, "utf8")
  await writeFile(path.join(coreB, "app/core-lifecycle-fixture.ts"), "export const lifecycleFixture = true\n", "utf8")
  await rm(path.join(coreB, "app/robots.ts"))

  let result = run(coreA, ["init", "Lifecycle Clean", cleanProduct])
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

  console.log(JSON.stringify({ status: "PASS", cleanUpdate: true, dryRunMatchesApply: true, backup: true, conflictPreserved: true, conflictDidNotMutateOthers: true, productOwnedPreserved: true, rollback: true, rollbackDoctor: true }))
} finally {
  await rm(fixture, { recursive: true, force: true })
}
