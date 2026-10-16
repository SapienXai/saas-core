import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"

const root = process.cwd()
const fixture = mkdtempSync(path.join(os.tmpdir(), "saas-core-release-recovery-"))
const artifacts = path.join(fixture, "artifacts")
const stateFile = path.join(fixture, "registry-state.json")
const logFile = path.join(fixture, "publish-log.json")
const mockNpm = path.join(fixture, "mock-npm.mjs")
const packageMap = Object.fromEntries(PACKAGE_NAMES.map((name) => [artifactName(name), name]))

function artifactName(packageName) {
  return `${packageName.replace(/^@/, "").replace("/", "-")}-${RELEASE_VERSION}.tgz`
}

function artifactFile(packageName) {
  return path.join(artifacts, artifactName(packageName))
}

function identity(file) {
  const bytes = readFileSync(file)
  return {
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    shasum: createHash("sha1").update(bytes).digest("hex"),
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function writeState({ published = [], acceptedButHidden = [], mismatched = [], networkFailure = [], visibilityDelay = 0 } = {}) {
  const packages = Object.fromEntries(PACKAGE_NAMES.map((name) => [name, { published: false }]))
  for (const name of published) packages[name] = { published: true, ...identity(artifactFile(name)) }
  for (const name of acceptedButHidden) packages[name] = { published: true, ...identity(artifactFile(name)) }
  for (const name of mismatched) packages[name] = { published: true, integrity: "sha512-not-the-local-artifact", shasum: "not-the-local-artifact" }
  const remainingVisibilityMisses = Object.fromEntries([...published, ...acceptedButHidden].map((name) => [name, visibilityDelay]))
  writeFileSync(stateFile, JSON.stringify({ packages, networkFailure, visibilityDelay, remainingVisibilityMisses }, null, 2))
  writeFileSync(logFile, "[]")
}

function run(script, args = []) {
  return spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    env: {
      ...process.env,
      RELEASE_VERSION,
      RELEASE_NPM_REGISTRY: "https://mock.registry.invalid/",
      RELEASE_NPM_CLI: mockNpm,
      RELEASE_ARTIFACT_DIR: artifacts,
      RELEASE_MOCK_STATE: stateFile,
      RELEASE_MOCK_LOG: logFile,
      RELEASE_MOCK_PACKAGE_MAP: JSON.stringify(packageMap),
      RELEASE_REGISTRY_POLL_INTERVAL_MS: "1",
      RELEASE_REGISTRY_POLL_TIMEOUT_MS: "1000",
      SAAS_CORE_PUBLIC_RELEASE_APPROVED: "true",
      SAAS_CORE_NPM_BOOTSTRAP_APPROVED: "",
      NODE_AUTH_TOKEN: "",
    },
    encoding: "utf8",
  })
}

function finalJson(result) {
  const candidates = [result.stderr || "", result.stdout || ""]
    .flatMap((stream) => stream.trim().split("\n").filter(Boolean).reverse())
  for (const line of candidates) {
    try {
      return JSON.parse(line)
    } catch {}
  }
  throw new Error(`Unable to parse release summary.\n${result.stdout}\n${result.stderr}`)
}

function publishLog() {
  return JSON.parse(readFileSync(logFile, "utf8"))
}

try {
  mkdirSync(artifacts, { recursive: true })
  for (const name of PACKAGE_NAMES) writeFileSync(artifactFile(name), `deterministic release artifact for ${name}@${RELEASE_VERSION}\n`)

  const mockSource = `#!/usr/bin/env node
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const stateFile = process.env.RELEASE_MOCK_STATE
const logFile = process.env.RELEASE_MOCK_LOG
const packageMap = JSON.parse(process.env.RELEASE_MOCK_PACKAGE_MAP)
const state = JSON.parse(readFileSync(stateFile, "utf8"))
const args = process.argv.slice(2)
const command = args[0]
const spec = args[1] || ""
const at = spec.lastIndexOf("@")
const packageName = at > 0 ? spec.slice(0, at) : null

if (command === "view") {
  if (state.networkFailure.includes(packageName)) {
    console.error("npm error code EAI_AGAIN")
    console.error("npm error request to mock registry failed")
    process.exit(1)
  }
  const packageState = state.packages[packageName]
  if (packageState?.published && (state.remainingVisibilityMisses?.[packageName] || 0) > 0) {
    state.remainingVisibilityMisses[packageName] -= 1
    writeFileSync(stateFile, JSON.stringify(state, null, 2))
    console.error("npm error code E404")
    console.error("npm error 404 No match found for " + spec)
    process.exit(1)
  }
  if (!packageState?.published) {
    console.error("npm error code E404")
    console.error("npm error 404 No match found for " + spec)
    process.exit(1)
  }
  process.stdout.write(JSON.stringify([{ integrity: packageState.integrity, shasum: packageState.shasum }]))
  process.exit(0)
}

if (command === "publish") {
  const artifact = args[1]
  const name = packageMap[path.basename(artifact)]
  if (!name) {
    console.error("mock publish received an unknown artifact")
    process.exit(1)
  }
  if (state.packages[name]?.published) {
    console.error("npm error code E403")
    console.error("npm error 403 Cannot publish over existing versions: ${RELEASE_VERSION}")
    process.exit(1)
  }
  const bytes = readFileSync(artifact)
  state.packages[name] = {
    published: true,
    integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
    shasum: createHash("sha1").update(bytes).digest("hex"),
  }
  state.remainingVisibilityMisses[name] = state.visibilityDelay || 0
  writeFileSync(stateFile, JSON.stringify(state, null, 2))
  const log = JSON.parse(readFileSync(logFile, "utf8"))
  log.push(name)
  writeFileSync(logFile, JSON.stringify(log, null, 2))
  process.exit(0)
}

console.error("mock npm does not implement " + command)
process.exit(1)
`

  writeFileSync(mockNpm, mockSource)
  chmodSync(mockNpm, 0o755)

  writeState()
  let result = run("check-registry-release.mjs", ["--preflight"])
  let summary = finalJson(result)
  assert(result.status === 0 && summary.absent === 5 && summary.publishRequired === true, `Scenario A preflight must plan all five packages: ${JSON.stringify(summary)}\n${result.stdout}\n${result.stderr}`)

  writeState()
  result = run("publish-npm-release.mjs")
  summary = finalJson(result)
  assert(result.status === 0 && publishLog().length === 5, "Scenario A must publish and immediately verify all five packages.")
  assert(summary.reports.every((report) => report.publication === "PUBLISHED_AND_VERIFIED"), "Scenario A publication report is incomplete.")

  writeState({ published: PACKAGE_NAMES.slice(0, 2) })
  result = run("check-registry-release.mjs", ["--preflight"])
  summary = finalJson(result)
  assert(result.status === 0 && summary.verified === 2 && summary.absent === 3 && summary.resumable === true, "Scenario B preflight must identify a resumable partial publication.")

  writeState({ published: PACKAGE_NAMES.slice(0, 2) })
  result = run("publish-npm-release.mjs")
  summary = finalJson(result)
  assert(result.status === 0 && publishLog().length === 3, "Scenario B must publish only the three absent packages.")
  assert(summary.reports.slice(0, 2).every((report) => report.publication === "ALREADY_PRESENT_AND_VERIFIED"), "Scenario B must skip the two verified packages.")
  assert(summary.reports.slice(2).every((report) => report.publication === "PUBLISHED_AND_VERIFIED"), "Scenario B must verify each resumed publication.")

  writeState({ visibilityDelay: 2 })
  result = run("publish-npm-release.mjs")
  summary = finalJson(result)
  assert(result.status === 0 && publishLog().length === 5, "Scenario F must wait for npm registry visibility after accepted publications.")
  assert(summary.reports.length === 5 && summary.reports.every((report) => report.publication === "PUBLISHED_AND_VERIFIED"), `Scenario F must report all delayed packages only after integrity verification: ${JSON.stringify(summary)}\n${result.stdout}\n${result.stderr}`)

  writeState({ acceptedButHidden: [PACKAGE_NAMES[0]], visibilityDelay: 3 })
  result = run("publish-npm-release.mjs")
  summary = finalJson(result)
  assert(result.status === 0 && publishLog().length === 4, "Scenario G must treat an immutable-version conflict as a pending publication and continue without republishing it.")
  assert(summary.reports.length === 5 && summary.reports.every((report) => report.publication === "PUBLISHED_AND_VERIFIED"), "Scenario G must verify the already-accepted hidden package and all new packages.")

  writeState({ published: PACKAGE_NAMES })
  result = run("check-registry-release.mjs", ["--preflight"])
  summary = finalJson(result)
  assert(result.status === 0 && summary.verified === 5 && summary.absent === 0 && summary.publishRequired === false, "Scenario C preflight must be a no-op publication plan.")

  writeState({ published: PACKAGE_NAMES })
  result = run("publish-npm-release.mjs")
  summary = finalJson(result)
  assert(result.status === 0 && publishLog().length === 0, "Scenario C must not call npm publish.")
  assert(summary.reports.every((report) => report.publication === "ALREADY_PRESENT_AND_VERIFIED"), "Scenario C must report every package as verified and skipped.")

  writeState({ mismatched: [PACKAGE_NAMES[0]] })
  result = run("check-registry-release.mjs", ["--preflight"])
  summary = finalJson(result)
  assert(result.status !== 0 && summary.status === "HARD_FAIL" && summary.reports[0].state === "PRESENT_BUT_UNVERIFIED_OR_MISMATCHED", "Scenario D preflight must hard-fail on an identity mismatch.")
  result = run("publish-npm-release.mjs")
  assert(result.status !== 0 && publishLog().length === 0, "Scenario D must fail before any publication call.")

  writeState({ networkFailure: [PACKAGE_NAMES[0]] })
  result = run("check-registry-release.mjs", ["--preflight"])
  summary = finalJson(result)
  assert(result.status !== 0 && summary.status === "HARD_FAIL" && summary.reports[0].state === "INDETERMINATE", "Scenario E preflight must hard-fail on registry/network indeterminacy.")
  result = run("publish-npm-release.mjs")
  assert(result.status !== 0 && publishLog().length === 0, "Scenario E must fail before any publication call.")

  console.log(JSON.stringify({
    status: "PASS",
    scenarios: {
      A: "0/5 absent -> 5 planned and published",
      B: "2/5 exact -> 2 skipped, 3 published and verified",
      C: "5/5 exact -> no publish calls",
      D: "identity mismatch -> hard fail before publish",
      E: "registry/network indeterminate -> hard fail before publish",
      F: "accepted npm publish with delayed visibility -> poll until all artifact identities verify",
      G: "accepted-but-not-yet-visible version conflict -> verify the immutable existing artifact without republishing",
    },
  }))
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
