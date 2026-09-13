import { spawnSync } from "node:child_process"
import path from "node:path"
import { allExpectedPackages, expectedVersion, inspectPackage, npmCommand, packageReports, registry, RELEASE_STATES } from "./npm-release-state.mjs"

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
    stdio: "inherit",
  })

  if (result.status !== 0) {
    finalReports.push({ ...report, publication: "FAILED" })
    for (const remaining of packageNames.slice(index + 1)) finalReports.push({ packageName: remaining, version: expectedVersion, publication: "NOT_ATTEMPTED" })
    console.error(JSON.stringify({ status: "FAILED", version: expectedVersion, registry, reports: finalReports }))
    process.exit(1)
  }

  const verified = inspectPackage(packageName)
  if (verified.state !== RELEASE_STATES.PRESENT_AND_VERIFIED) {
    finalReports.push({ ...verified, publication: "PUBLISHED_BUT_UNVERIFIED" })
    for (const remaining of packageNames.slice(index + 1)) finalReports.push({ packageName: remaining, version: expectedVersion, publication: "NOT_ATTEMPTED" })
    console.error(JSON.stringify({ status: "FAILED", version: expectedVersion, registry, reports: finalReports }))
    process.exit(1)
  }

  finalReports.push({ ...verified, publication: "PUBLISHED_AND_VERIFIED" })
  console.log(`${packageName}@${expectedVersion} PUBLISHED_AND_VERIFIED`)
}

console.log(JSON.stringify({ status: "PASS", registry, version: expectedVersion, reports: finalReports }))
