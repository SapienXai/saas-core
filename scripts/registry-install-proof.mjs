import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"

const registry = process.env.RELEASE_NPM_REGISTRY || "https://registry.npmjs.org/"
const expectedVersion = process.env.RELEASE_VERSION || RELEASE_VERSION
if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error(`Invalid release version: ${expectedVersion}`)
const fixture = mkdtempSync(path.join(os.tmpdir(), "saas-core-registry-proof-"))
const consumer = path.join(fixture, "consumer")
const app = path.join(consumer, "registry-proof")
const packageSpecs = PACKAGE_NAMES.map((name) => `${name}@${expectedVersion}`)
const npmrc = `registry=https://registry.npmjs.org/\n@sapienx:registry=${registry}\n`

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" }, encoding: "utf8", stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status ?? "unknown status"}.`)
}

function packageVersion(directory, name) {
  const packageFile = path.join(directory, "node_modules", ...name.split("/"), "package.json")
  if (!existsSync(packageFile)) throw new Error(`Registry consumer is missing ${name}.`)
  const packageJson = JSON.parse(readFileSync(packageFile, "utf8"))
  if (packageJson.version !== expectedVersion) throw new Error(`${name} resolved to ${packageJson.version}, expected ${expectedVersion}.`)
  const realPackage = path.dirname(execFileSync("realpath", [packageFile], { encoding: "utf8" }).trim())
  if (realPackage.startsWith(process.cwd())) throw new Error(`${name} resolved back to the Core checkout.`)
}

try {
  writeFileSync(path.join(fixture, ".npmrc"), npmrc, "utf8")
  run("npm", ["init", "--yes"], fixture)
  run("npm", ["install", "--ignore-scripts", "--no-package-lock", ...packageSpecs], fixture)
  for (const name of PACKAGE_NAMES) packageVersion(fixture, name)

  const cli = path.join(fixture, "node_modules", ".bin", "saas-core")
  if (!existsSync(cli)) throw new Error("Registry consumer did not install the saas-core executable.")
  run(cli, ["init", "Registry Proof", app], fixture)
  run(cli, ["doctor", app], fixture)
  writeFileSync(path.join(app, ".npmrc"), npmrc, "utf8")
  run("npm", ["install", "--no-package-lock"], app)
  for (const name of PACKAGE_NAMES.filter((value) => value !== "@sapienx/saas-core-app")) packageVersion(app, name)
  run("npm", ["run", "typecheck"], app)
  run("npm", ["test", "--", "--run"], app)
  run("npm", ["run", "build"], app)
  console.log(JSON.stringify({ status: "PASS", registry, version: expectedVersion, consumer, generatedApp: app, freshInstall: true, localCheckoutResolution: false, typecheck: true, tests: true, build: true }))
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
