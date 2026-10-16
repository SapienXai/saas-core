import { spawnSync } from "node:child_process"
import path from "node:path"
import { allExpectedPackages, expectedVersion, inspectPackage, npmCommand, packageReports, registry, RELEASE_STATES } from "./npm-release-state.mjs"

const registryPollIntervalMs = Number(process.env.RELEASE_REGISTRY_POLL_INTERVAL_MS || 5000)
const registryPollTimeoutMs = Number(process.env.RELEASE_REGISTRY_POLL_TIMEOUT_MS || 15 * 60 * 1000)

if (!Number.isFinite(registryPollIntervalMs) || registryPollIntervalMs < 1 || registryPollIntervalMs > 60_000) {
  throw new Error("RELEASE_REGISTRY_POLL_INTERVAL_MS must be between 1 and 60000.")
}
if (!Number.isFinite(registryPollTimeoutMs) || registryPollTimeoutMs < registryPollIntervalMs || registryPollTimeoutMs > 60 * 60 * 1000) {
  throw new Error("RELEASE_REGISTRY_POLL_TIMEOUT_MS must be between the poll interval and 3600000.")
}

if (process.env.SAAS_CORE_PUBLIC_RELEASE_APPROVED !== "true") throw new Error("Public npm publication requires SAAS_CORE_PUBLIC_RELEASE_APPROVED=true.")
if (process.env.SAAS_CORE_NPM_BOOTSTRAP_APPROVED === "true" && !process.env.NODE_AUTH_TOKEN) throw new Error("Bootstrap approval requires NODE_AUTH_TOKEN for the publication step.")
if (process.env.SAAS_CORE_NPM_BOOTSTRAP_APPROVED !== "true" && process.env.NODE_AUTH_TOKEN) throw new Error("NODE_AUTH_TOKEN is only allowed when SAAS_CORE_NPM_BOOTSTRAP_APPROVED=true.")

const packageNames = allExpectedPackages()
const reports = packageNames.map((packageName) => inspectPackage(packageName))
console.log(packageReports(reports))

if (reports.some((report) => [RELEASE_STATES.PRESENT_BUT_UNVERIFIED_OR_MISMATCHED, RELEASE_STATES.INDETERMINATE].includes(report.state))) {
  console.error(JSON.stringify({ status: "HARD_FAIL", version: expectedVersion, registry, reports }))
  process.exit(1)
}

const finalReports = []
const awaitingRegistry = []

function isAlreadyPublishedConflict(output) {
  return /(?:E409|E403)[\s\S]*(?:already exists|previously published|cannot publish over|cannot overwrite)|(?:already exists|previously published|cannot publish over|cannot overwrite)[\s\S]*(?:version|package)/i.test(output)
}

function printPublishOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function waitForRegistryPublication() {
  const deadline = Date.now() + registryPollTimeoutMs
  const latest = new Map(awaitingRegistry.map(({ packageName, report }) => [packageName, report]))

  while (Date.now() < deadline && latest.size > 0) {
    for (const packageName of [...latest.keys()]) {
      const report = inspectPackage(packageName)
      latest.set(packageName, report)

      if (report.state === RELEASE_STATES.PRESENT_AND_VERIFIED) {
        finalReports.push({ ...report, publication: "PUBLISHED_AND_VERIFIED" })
        console.log(`${packageName}@${expectedVersion} PUBLISHED_AND_VERIFIED`)
        latest.delete(packageName)
        continue
      }

      if (report.state === RELEASE_STATES.PRESENT_BUT_UNVERIFIED_OR_MISMATCHED) {
        console.error(`${packageName}@${expectedVersion} registry identity does not match the validated local artifact.`)
        latest.delete(packageName)
        finalReports.push({ ...report, publication: "PUBLISHED_BUT_MISMATCHED" })
        for (const remaining of latest.keys()) finalReports.push({ ...latest.get(remaining), publication: "PUBLISH_ACCEPTED_BUT_UNVERIFIED" })
        console.error(JSON.stringify({ status: "HARD_FAIL", version: expectedVersion, registry, reports: finalReports }))
        process.exit(1)
      }
    }

    if (latest.size > 0) {
      const elapsedMs = registryPollTimeoutMs - Math.max(0, deadline - Date.now())
      console.log(`Waiting for ${latest.size} npm package(s) to become visible (${Math.ceil(elapsedMs / 1000)}s elapsed).`)
      await new Promise((resolve) => setTimeout(resolve, registryPollIntervalMs))
    }
  }

  if (latest.size > 0) {
    for (const report of latest.values()) {
      finalReports.push({ ...report, publication: "PUBLISHED_BUT_UNVERIFIED" })
    }
    console.error(JSON.stringify({ status: "PENDING_REGISTRY_VISIBILITY", version: expectedVersion, registry, timeoutMs: registryPollTimeoutMs, reports: finalReports }))
    process.exit(1)
  }
}
for (let index = 0; index < packageNames.length; index += 1) {
  const packageName = packageNames[index]
  const report = inspectPackage(packageName)

  if (report.state === RELEASE_STATES.PRESENT_AND_VERIFIED) {
    finalReports.push({ ...report, publication: "ALREADY_PRESENT_AND_VERIFIED" })
    console.log(`${packageName}@${expectedVersion} ALREADY_PRESENT_AND_VERIFIED`)
    continue
  }

  if (report.state !== RELEASE_STATES.ABSENT) {
    finalReports.push({ ...report, publication: report.state })
    for (const remaining of packageNames.slice(index + 1)) finalReports.push({ packageName: remaining, version: expectedVersion, publication: "NOT_ATTEMPTED" })
    console.error(JSON.stringify({ status: "HARD_FAIL", version: expectedVersion, registry, reports: finalReports }))
    process.exit(1)
  }

  const result = spawnSync(npmCommand, ["publish", path.resolve(report.artifact), "--access", "public", "--registry", registry], {
    env: process.env,
    encoding: "utf8",
  })
  printPublishOutput(result)

  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}\n${result.error?.message || ""}`
    if (!isAlreadyPublishedConflict(output)) {
      finalReports.push({ ...report, publication: "FAILED" })
      for (const remaining of packageNames.slice(index + 1)) finalReports.push({ packageName: remaining, version: expectedVersion, publication: "NOT_ATTEMPTED" })
      console.error(JSON.stringify({ status: "FAILED", version: expectedVersion, registry, reports: finalReports }))
      process.exit(1)
    }

    console.log(`${packageName}@${expectedVersion} already has a registry version; waiting to verify its immutable artifact.`)
  }

  const verified = inspectPackage(packageName)
  if (verified.state === RELEASE_STATES.PRESENT_BUT_UNVERIFIED_OR_MISMATCHED) {
    finalReports.push({ ...verified, publication: "PUBLISHED_BUT_MISMATCHED" })
    for (const remaining of packageNames.slice(index + 1)) finalReports.push({ packageName: remaining, version: expectedVersion, publication: "NOT_ATTEMPTED" })
    console.error(JSON.stringify({ status: "HARD_FAIL", version: expectedVersion, registry, reports: finalReports }))
    process.exit(1)
  }

  if (verified.state === RELEASE_STATES.PRESENT_AND_VERIFIED) {
    finalReports.push({ ...verified, publication: "PUBLISHED_AND_VERIFIED" })
    console.log(`${packageName}@${expectedVersion} PUBLISHED_AND_VERIFIED`)
  } else {
    awaitingRegistry.push({ packageName, report: verified })
  }
}

if (awaitingRegistry.length > 0) await waitForRegistryPublication()

console.log(JSON.stringify({ status: "PASS", registry, version: expectedVersion, reports: finalReports }))
