import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"

const expectedVersion = process.env.RELEASE_VERSION || RELEASE_VERSION
const registry = process.env.RELEASE_NPM_REGISTRY || "https://registry.npmjs.org/"

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error(`Invalid release version: ${expectedVersion}`)
if (process.env.SAAS_CORE_PUBLIC_RELEASE_APPROVED !== "true") throw new Error("Public npm publication requires SAAS_CORE_PUBLIC_RELEASE_APPROVED=true.")

for (const packageName of PACKAGE_NAMES) {
  const artifact = path.join("artifacts", `${packageName.replace(/^@/, "").replace("/", "-")}-${expectedVersion}.tgz`)
  if (!existsSync(artifact)) throw new Error(`Missing release artifact for ${packageName}@${expectedVersion}: ${artifact}`)

  const result = spawnSync("npm", ["publish", artifact, "--access", "public", "--registry", registry], {
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  })
  if (result.status !== 0) throw new Error(`npm publish failed for ${packageName}@${expectedVersion}.`)
}

console.log(JSON.stringify({ status: "PASS", registry, version: expectedVersion, packages: PACKAGE_NAMES }))
