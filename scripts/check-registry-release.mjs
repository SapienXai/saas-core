import { spawnSync } from "node:child_process"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"

const mode = process.argv.includes("--verify") ? "verify" : process.argv.includes("--preflight") ? "preflight" : "help"
const registry = process.env.RELEASE_NPM_REGISTRY || "https://registry.npmjs.org/"

if (mode === "help") {
  console.error("Usage: node scripts/check-registry-release.mjs --preflight|--verify")
  process.exit(1)
}

function query(packageName) {
  const result = spawnSync("npm", ["view", `${packageName}@${RELEASE_VERSION}`, "version", "--json", "--registry", registry], { encoding: "utf8" })
  return { ...result, output: `${result.stdout || ""}\n${result.stderr || ""}`.trim() }
}

for (const packageName of PACKAGE_NAMES) {
  const result = query(packageName)
  if (mode === "verify") {
    if (result.status !== 0) throw new Error(`Registry verification failed for ${packageName}@${RELEASE_VERSION}: ${result.output}`)
    let value
    try { value = JSON.parse(result.stdout) } catch { value = result.stdout.trim().replace(/^['"]|['"]$/g, "") }
    if (String(value) !== RELEASE_VERSION) throw new Error(`Registry returned ${packageName}@${RELEASE_VERSION} as ${String(value)}.`)
    console.log(`Verified ${packageName}@${RELEASE_VERSION} on ${registry}`)
    continue
  }

  if (result.status === 0) throw new Error(`${packageName}@${RELEASE_VERSION} already exists on ${registry}; refusing an immutable-version republish.`)
  if (!/(?:\bE404\b|404 Not Found|No match found)/i.test(result.output)) {
    throw new Error(`Registry preflight could not prove ${packageName}@${RELEASE_VERSION} is unpublished: ${result.output}`)
  }
  console.log(`Available for first publication: ${packageName}@${RELEASE_VERSION}`)
}

console.log(JSON.stringify({ status: "PASS", mode, registry, version: RELEASE_VERSION, packages: PACKAGE_NAMES }))
