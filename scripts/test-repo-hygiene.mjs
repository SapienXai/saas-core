import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = process.cwd()
const fixture = mkdtempSync(path.join(os.tmpdir(), "saas-core-repo-hygiene-"))
const checker = path.join(root, "scripts/repo-hygiene.mjs")

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runChecker() {
  return spawnSync(process.execPath, [checker, "--root", fixture], { encoding: "utf8" })
}

try {
  mkdirSync(path.join(fixture, ".next"), { recursive: true })
  mkdirSync(path.join(fixture, ".playwright-cli"), { recursive: true })
  mkdirSync(path.join(fixture, "artifacts"), { recursive: true })
  writeFileSync(path.join(fixture, ".next", "cache.js"), "generated\n", "utf8")
  writeFileSync(path.join(fixture, ".playwright-cli", "page.yml"), "runtime\n", "utf8")
  writeFileSync(path.join(fixture, "artifacts", "package.tgz"), "artifact\n", "utf8")
  writeFileSync(path.join(fixture, "README.md"), "canonical source\n", "utf8")
  writeFileSync(path.join(fixture, ".env.example"), `PADDLE_API_KEY=${"sk_" + "test_"}example-placeholder\n`, "utf8")
  execFileSync("git", ["-C", fixture, "init", "--quiet"])
  execFileSync("git", ["-C", fixture, "add", "."])

  const failed = runChecker()
  const failedOutput = `${failed.stdout || ""}\n${failed.stderr || ""}`
  assert(failed.status !== 0, "repo:hygiene accepted tracked fake forbidden paths")
  for (const file of [".next/cache.js", ".playwright-cli/page.yml", "artifacts/package.tgz"]) assert(failedOutput.includes(file), `repo:hygiene did not identify ${file}`)

  rmSync(path.join(fixture, ".next"), { recursive: true, force: true })
  rmSync(path.join(fixture, ".playwright-cli"), { recursive: true, force: true })
  rmSync(path.join(fixture, "artifacts"), { recursive: true, force: true })
  execFileSync("git", ["-C", fixture, "add", "-A"])
  const passed = runChecker()
  assert(passed.status === 0, `repo:hygiene rejected a clean temporary repository: ${passed.stderr || passed.stdout}`)
  const summary = JSON.parse(passed.stdout)
  assert(summary.status === "PASS", "repo:hygiene clean-path result was not PASS")
  console.log(JSON.stringify({ status: "PASS", rejectedFakePaths: true, acceptedCleanFixture: true, fixtureOutsideRepository: true }))
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
