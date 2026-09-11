import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"

export const RELEASE_STATES = Object.freeze({
  ABSENT: "ABSENT",
  PRESENT_AND_VERIFIED: "PRESENT_AND_VERIFIED",
  PRESENT_BUT_UNVERIFIED_OR_MISMATCHED: "PRESENT_BUT_UNVERIFIED_OR_MISMATCHED",
  INDETERMINATE: "INDETERMINATE",
})

export const expectedVersion = process.env.RELEASE_VERSION || RELEASE_VERSION
export const registry = process.env.RELEASE_NPM_REGISTRY || "https://registry.npmjs.org/"
export const npmCommand = process.env.RELEASE_NPM_CLI || "npm"
export const artifactDirectory = process.env.RELEASE_ARTIFACT_DIR || "artifacts"

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error(`Invalid release version: ${expectedVersion}`)

export function artifactPath(packageName, version = expectedVersion) {
  return path.join(artifactDirectory, `${packageName.replace(/^@/, "").replace("/", "-")}-${version}.tgz`)
}

export function artifactIdentity(file) {
  if (!existsSync(file)) throw new Error(`Missing local release artifact: ${file}`)
  const bytes = readFileSync(file)
  return {
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    shasum: createHash("sha1").update(bytes).digest("hex"),
  }
}

function outputFor(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}\n${result.error?.message || ""}`.trim()
}

function isNotFound(result) {
  return result.status !== 0 && /(?:\bE404\b|404 Not Found|No match found)/i.test(outputFor(result))
}

function parseDistribution(stdout) {
  const parsed = JSON.parse(stdout)
  const value = Array.isArray(parsed) ? parsed[0] : parsed
  return value?.dist && typeof value.dist === "object" ? value.dist : value
}

export function inspectPackage(packageName, version = expectedVersion) {
  const artifact = artifactPath(packageName, version)
  const local = artifactIdentity(artifact)
  const spec = `${packageName}@${version}`
  const result = spawnSync(npmCommand, ["view", spec, "dist", "--json", "--registry", registry], { encoding: "utf8" })

  if (isNotFound(result)) {
    return { packageName, version, artifact, state: RELEASE_STATES.ABSENT, local, registry: null }
  }

  if (result.status !== 0) {
    return { packageName, version, artifact, state: RELEASE_STATES.INDETERMINATE, local, registry: null, reason: outputFor(result) || `npm view exited with ${result.status ?? "unknown status"}` }
  }

  let distribution
  try {
    distribution = parseDistribution(result.stdout)
  } catch (error) {
    return { packageName, version, artifact, state: RELEASE_STATES.INDETERMINATE, local, registry: null, reason: `Registry returned invalid dist metadata: ${error.message}` }
  }

  if (!distribution || typeof distribution !== "object") {
    return { packageName, version, artifact, state: RELEASE_STATES.PRESENT_BUT_UNVERIFIED_OR_MISMATCHED, local, registry: distribution ?? null, reason: "Registry returned no dist integrity metadata." }
  }

  const registryIdentity = { integrity: distribution.integrity, shasum: distribution.shasum }
  if (typeof registryIdentity.integrity === "string" && registryIdentity.integrity.length > 0) {
    if (registryIdentity.integrity === local.integrity) {
      return { packageName, version, artifact, state: RELEASE_STATES.PRESENT_AND_VERIFIED, local, registry: registryIdentity, verifiedBy: "dist.integrity" }
    }
    return { packageName, version, artifact, state: RELEASE_STATES.PRESENT_BUT_UNVERIFIED_OR_MISMATCHED, local, registry: registryIdentity, reason: "Registry dist.integrity does not match the local artifact." }
  }

  if (typeof registryIdentity.shasum === "string" && registryIdentity.shasum.length > 0 && registryIdentity.shasum === local.shasum) {
    return { packageName, version, artifact, state: RELEASE_STATES.PRESENT_AND_VERIFIED, local, registry: registryIdentity, verifiedBy: "dist.shasum" }
  }

  return { packageName, version, artifact, state: RELEASE_STATES.PRESENT_BUT_UNVERIFIED_OR_MISMATCHED, local, registry: registryIdentity, reason: "Registry dist metadata does not match the local artifact." }
}

export function packageReports(reports) {
  return reports.map((report) => `${report.packageName}@${report.version} ${report.state}${report.reason ? ` — ${report.reason}` : ""}`).join("\n")
}

export function allExpectedPackages() {
  return [...PACKAGE_NAMES]
}
