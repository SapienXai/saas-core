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

async function fsTemp(prefix) {
  const directory = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), prefix)))
  return directory
}

function run(template, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, SAAS_CORE_TEMPLATE: template }, encoding: "utf8" })
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

  let result = run(coreA, ["init", "Lifecycle Clean", cleanProduct], root)
  assert(result.status === 0, result.stderr || "clean init failed")
  await writeFile(path.join(cleanProduct, "app/page.tsx"), `${await readFile(path.join(cleanProduct, "app/page.tsx"), "utf8")}\n// product-owned customization\n`, "utf8")
  await writeFile(path.join(cleanProduct, "product.catalog.json"), JSON.stringify({ plans: [{ key: "hobby", name: "Hobby", prices: { month: { amount: 7, currency: "EUR" } } }], usageMetrics: [{ key: "projects", name: "Projects" }] }, null, 2) + "\n", "utf8")
  result = run(coreB, ["update", cleanProduct, "--dry-run", "--json"], root)
  assert(result.status === 0, result.stderr || "dry-run failed")
  const dryRun = JSON.parse(result.stdout)
  assert(dryRun.updated.includes("app/error.tsx") && dryRun.added.includes("app/core-lifecycle-fixture.ts") && dryRun.removed.includes("app/robots.ts"), "dry-run did not report changed/added/removed managed files")
  result = run(coreB, ["update", cleanProduct, "--json"], root)
  assert(result.status === 0, result.stderr || "clean update failed")
  const cleanReport = JSON.parse(result.stdout)
  assert(cleanReport.backup && existsSync(cleanReport.backup), "clean update did not create a backup")
  assert((await readFile(path.join(cleanProduct, "app/page.tsx"), "utf8")).includes("product-owned customization"), "product customization was overwritten")
  result = run(coreB, ["doctor", cleanProduct, "--json"], root)
  assert(result.status === 0, result.stderr || "post-update doctor failed")

  result = run(coreA, ["init", "Lifecycle Conflict", conflictProduct], root)
  assert(result.status === 0, result.stderr || "conflict init failed")
  const conflictFile = path.join(conflictProduct, "app/error.tsx")
  const localContent = `${await readFile(conflictFile, "utf8")}\n// local managed modification\n`
  await writeFile(conflictFile, localContent, "utf8")
  result = run(coreB, ["update", conflictProduct, "--json"], root)
  assert(result.status === 2, "managed modification did not produce an update conflict")
  const conflictReport = JSON.parse(result.stdout)
  assert(conflictReport.conflicts.includes("app/error.tsx"), "conflict report omitted modified managed file")
  assert((await readFile(conflictFile, "utf8")) === localContent, "conflicting managed file was overwritten")
  console.log(JSON.stringify({ status: "PASS", cleanUpdate: true, dryRun: true, backup: true, conflictPreserved: true, productOwnedPreserved: true }))
} finally {
  await rm(fixture, { recursive: true, force: true })
}
