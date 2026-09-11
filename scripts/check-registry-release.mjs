import { allExpectedPackages, expectedVersion, inspectPackage, packageReports, registry, RELEASE_STATES } from "./npm-release-state.mjs"

const mode = process.argv.includes("--verify") ? "verify" : process.argv.includes("--preflight") ? "preflight" : "help"

if (mode === "help") {
  console.error("Usage: node scripts/check-registry-release.mjs --preflight|--verify")
  process.exit(1)
}

const reports = allExpectedPackages().map((packageName) => inspectPackage(packageName))
console.log(packageReports(reports))

const hardFailures = reports.filter((report) => [RELEASE_STATES.PRESENT_BUT_UNVERIFIED_OR_MISMATCHED, RELEASE_STATES.INDETERMINATE].includes(report.state))
if (hardFailures.length > 0) {
  console.error(JSON.stringify({ status: "HARD_FAIL", mode, registry, version: expectedVersion, reports }))
  process.exit(1)
}

if (mode === "verify" && reports.some((report) => report.state !== RELEASE_STATES.PRESENT_AND_VERIFIED)) {
  console.error(JSON.stringify({ status: "HARD_FAIL", mode, registry, version: expectedVersion, reason: "Every package must be present and integrity-verified after publication.", reports }))
  process.exit(1)
}

const absent = reports.filter((report) => report.state === RELEASE_STATES.ABSENT).length
const verified = reports.filter((report) => report.state === RELEASE_STATES.PRESENT_AND_VERIFIED).length
console.log(JSON.stringify({ status: "PASS", mode, registry, version: expectedVersion, packages: allExpectedPackages(), absent, verified, publishRequired: absent > 0, resumable: absent > 0 && verified > 0 }))
