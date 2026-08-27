import { execFileSync, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = process.cwd()
const packageCli = path.join(root, "packages/cli/bin/saas-core.mjs")
const artifacts = path.join(root, "artifacts")
const npmCache = mkdtempSync(path.join(os.tmpdir(), "saas-core-npm-cache-"))
const product = mkdtempSync(path.join(os.tmpdir(), "saas-core-product-"))
const relocatedParent = mkdtempSync(path.join(os.tmpdir(), "saas-core-relocated-"))
const relocated = path.join(relocatedParent, "product")
const registryOutput = path.join(npmCache, "registry.url")
const registryProcess = spawn(process.execPath, [path.join(root, "scripts/local-package-registry.mjs"), artifacts, registryOutput], { stdio: "ignore" })
for (let attempt = 0; attempt < 50 && !existsSync(registryOutput); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
if (!existsSync(registryOutput)) throw new Error("Disposable package registry did not start.")
const registryUrl = readFileSync(registryOutput, "utf8").trim()
const npmEnvironment = { ...process.env, npm_config_cache: npmCache, npm_config_audit: "false", npm_config_fund: "false" }

function run(command, args, cwd, extraEnvironment = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...npmEnvironment, ...extraEnvironment }, stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status ?? "unknown status"}`)
}

async function bootAndSmoke(cwd, port) {
  const server = spawn("npm", ["run", "start", "--", "-p", String(port)], { cwd, env: npmEnvironment, stdio: "ignore" })
  try {
    let ready = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`)
        if (response.status < 500) {
          ready = true
          break
        }
      } catch {
        // Next is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!ready) throw new Error(`Generated consumer did not boot on port ${port}.`)
    for (const pathname of ["/", "/login", "/signup", "/forgot-password", "/manifest.webmanifest"]) {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`)
      if (response.status >= 500) throw new Error(`Generated consumer returned ${response.status} for ${pathname}.`)
    }
  } finally {
    server.kill("SIGTERM")
  }
}

try {
  run(process.execPath, [packageCli, "init", "Projects Proof", product], root)
  run(process.execPath, [packageCli, "doctor", product], root)
  writeFileSync(path.join(product, ".npmrc"), `registry=https://registry.npmjs.org/\n@saas-core:registry=${registryUrl}\n`, "utf8")
  run("npm", ["install", "--ignore-scripts", "--audit=false", "--fund=false"], product)
  run("npm", ["test"], product)
  run("npm", ["run", "build"], product)
  await bootAndSmoke(product, 3217)
  renameSync(product, relocated)

  run(process.execPath, [packageCli, "diff", relocated], root)
  rmSync(path.join(relocated, "node_modules"), { recursive: true, force: true })
  run("npm", ["ci", "--ignore-scripts", "--audit=false", "--fund=false"], relocated)
  run("npm", ["test"], relocated)
  run("npm", ["run", "build"], relocated)
  await bootAndSmoke(relocated, 3218)
  run(process.execPath, [packageCli, "update", relocated], root)
  run(process.execPath, [packageCli, "doctor", relocated], root)
  const packageJson = JSON.parse(execFileSync("node", ["-e", "console.log(require('fs').readFileSync('package.json','utf8'))"], { cwd: relocated, encoding: "utf8" }))
  if (JSON.stringify(packageJson).includes("file:") || JSON.stringify(packageJson).includes(root)) throw new Error("Generated consumer contains a local dependency path.")
  console.log(JSON.stringify({ status: "PASS", product: relocated, install: "packed Core through local registry", relocation: true, frozenInstall: true }))
} finally {
  registryProcess.kill("SIGTERM")
  rmSync(product, { recursive: true, force: true })
  rmSync(relocatedParent, { recursive: true, force: true })
  rmSync(npmCache, { recursive: true, force: true })
}
