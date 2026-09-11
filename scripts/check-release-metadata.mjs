import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION, SCHEMA_VERSION } from "./release-constants.mjs"

const root = process.cwd()
const packageDirectories = {
  "@sapienx/saas-core": "packages/core",
  "@sapienx/saas-core-config": "packages/config",
  "@sapienx/saas-core-ui": "packages/ui",
  "@sapienx/saas-core-app": "packages/app",
  "@sapienx/saas-core-cli": "packages/cli",
}
const packageFiles = ["package.json", ...PACKAGE_NAMES.map((name) => `${packageDirectories[name]}/package.json`)]

async function json(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"))
}

const rootPackage = await json("package.json")
if (rootPackage.version !== RELEASE_VERSION) throw new Error(`Root package must be ${RELEASE_VERSION}.`)

for (const relative of packageFiles.slice(1)) {
  const manifest = await json(relative)
  if (manifest.version !== RELEASE_VERSION) throw new Error(`${relative} is ${manifest.version}, expected ${RELEASE_VERSION}.`)
  if (manifest.private === true) throw new Error(`${relative} is private and cannot be published.`)
  for (const field of ["description", "license", "repository"]) if (!manifest[field]) throw new Error(`${relative} is missing ${field}.`)
}

const coreSource = await readFile(path.join(root, "packages/core/src/index.ts"), "utf8")
if (!coreSource.includes(`CORE_VERSION = "${RELEASE_VERSION}"`) || !coreSource.includes(`CORE_SCHEMA_VERSION = "${SCHEMA_VERSION}"`)) throw new Error("Core runtime/schema constants do not match the release coordinates.")
const coreManifest = await json("packages/core/manifest.json")
if (coreManifest.version !== RELEASE_VERSION) throw new Error("Core manifest version does not match the release coordinate.")
const cliSource = await readFile(path.join(root, "packages/cli/bin/saas-core.mjs"), "utf8")
if (!cliSource.includes(`const VERSION = "${RELEASE_VERSION}"`) || !cliSource.includes(`const SCHEMA_VERSION = "${SCHEMA_VERSION}"`)) throw new Error("CLI runtime/schema constants do not match the release coordinates.")
const uiSource = await readFile(path.join(root, "packages/ui/src/index.ts"), "utf8")
if (!uiSource.includes(`UI_SYSTEM_VERSION = "${RELEASE_VERSION}"`)) throw new Error("UI system version does not match the release coordinate.")

const tag = process.argv.find((value) => value.startsWith("saas-core-v"))
if (tag) {
  const match = /^saas-core-v(\d+\.\d+\.\d+)$/.exec(tag)
  if (!match || match[1] !== RELEASE_VERSION) throw new Error(`Tag ${tag} does not match SaaS Core ${RELEASE_VERSION}.`)
}

if (process.argv.includes("--require-clean")) {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()
  if (status) throw new Error(`Release checkout is not clean:\n${status}`)
}

console.log(JSON.stringify({ status: "PASS", version: RELEASE_VERSION, schemaVersion: SCHEMA_VERSION, packages: PACKAGE_NAMES, tag: tag || null }))
