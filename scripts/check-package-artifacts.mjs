import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"

const root = process.cwd()
const artifacts = path.join(root, "artifacts")
const packageDirectories = {
  "@sapienx/saas-core": "packages/core",
  "@sapienx/saas-core-config": "packages/config",
  "@sapienx/saas-core-ui": "packages/ui",
  "@sapienx/saas-core-app": "packages/app",
  "@sapienx/saas-core-cli": "packages/cli",
}
const forbiddenPath = /(?:^|\/)(?:\.git|\.env(?:\.|$)|node_modules|\.next|\.temp|\.branches)(?:\/|$)|(?:^|\/)(?:Users|private)\//
const forbiddenContent = /(?:workspace:|file:|link:|registry\.url|localhost:\d+|\/Users\/|\/private\/)/

for (const packageName of PACKAGE_NAMES) {
  const directory = packageDirectories[packageName]
  const dryRun = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: path.join(root, directory), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (dryRun.status !== 0) throw new Error(`npm pack --dry-run failed for ${packageName}: ${dryRun.stderr || dryRun.stdout}`)

  const filename = `${packageName.replace(/^@/, "").replace("/", "-")}-${RELEASE_VERSION}.tgz`
  const tarball = path.join(artifacts, filename)
  if (!existsSync(tarball)) throw new Error(`Missing packed artifact ${filename}. Run pnpm core:pack first.`)
  const packageJson = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }))
  if (packageJson.name !== packageName || packageJson.version !== RELEASE_VERSION) throw new Error(`${filename} has incorrect package identity.`)
  if (packageJson.private === true) throw new Error(`${filename} is marked private.`)
  const dependencyValues = Object.values({ ...packageJson.dependencies, ...packageJson.devDependencies, ...packageJson.optionalDependencies, ...packageJson.peerDependencies })
  if (dependencyValues.some((value) => typeof value === "string" && forbiddenContent.test(value))) throw new Error(`${filename} contains a local/workspace dependency reference.`)
  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean)
  if (listing.some((entry) => forbiddenPath.test(entry))) throw new Error(`${filename} contains a forbidden path.`)
  const files = listing.filter((entry) => entry.startsWith("package/")).map((entry) => entry.slice("package/".length))
  if (!files.includes("package.json") || !files.includes("README.md")) throw new Error(`${filename} is missing package metadata.`)
  if (forbiddenContent.test(JSON.stringify(packageJson))) throw new Error(`${filename} contains a local path, registry URL, or workspace protocol.`)
}

const coreTarball = path.join(artifacts, `sapienx-saas-core-${RELEASE_VERSION}.tgz`)
const coreDeclarations = execFileSync("tar", ["-xOf", coreTarball, "package/dist/index.d.ts"], { encoding: "utf8" })
for (const name of ["PlanDefinition", "validatePlanDefinition", "normalizeProductPlan", "classifyProductPlanChange", "duplicateProductPlan"]) {
  if (!coreDeclarations.includes(name)) throw new Error(`Core artifact is missing the plan catalog contract: ${name}.`)
}

const managedPlanFiles = [
  "package/template/supabase/migrations/20260914100000_reusable_plan_catalog_management.sql",
  "package/template/app/platform/billing/actions.ts",
  "package/template/app/platform/billing/page.tsx",
  "package/template/components/platform/platform-plan-management.tsx",
]
for (const packageName of ["@sapienx/saas-core-app", "@sapienx/saas-core-cli"]) {
  const filename = `${packageName.replace(/^@/, "").replace("/", "-")}-${RELEASE_VERSION}.tgz`
  const listing = execFileSync("tar", ["-tzf", path.join(artifacts, filename)], { encoding: "utf8" })
  for (const relative of managedPlanFiles) if (!listing.includes(`${relative}\n`)) throw new Error(`${filename} is missing managed plan file ${relative}.`)
}

const configTarball = path.join(artifacts, `sapienx-saas-core-config-${RELEASE_VERSION}.tgz`)
const configPackage = JSON.parse(execFileSync("tar", ["-xOf", configTarball, "package/package.json"], { encoding: "utf8" }))
if (configPackage.dependencies?.["@sapienx/saas-core"] !== `^${RELEASE_VERSION}`) throw new Error("Config tarball did not resolve its Core workspace dependency to the registry range.")

console.log(JSON.stringify({ status: "PASS", packages: PACKAGE_NAMES, version: RELEASE_VERSION, artifacts }))
