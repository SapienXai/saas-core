import { spawn, spawnSync } from "node:child_process"
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
  const generatedCatalog = JSON.parse(readFileSync(path.join(product, "product.catalog.json"), "utf8"))
  if (generatedCatalog.defaultPlanKey !== "default" || generatedCatalog.plans.length !== 1 || generatedCatalog.plans[0].key !== "default" || generatedCatalog.plans[0].prices) throw new Error("Generated consumer did not receive the neutral product-owned starter catalog.")
  if (!readFileSync(path.join(product, "supabase/seed.sql"), "utf8").includes("'default'")) throw new Error("Generated consumer seed does not bootstrap the neutral default plan.")
  const generatedPackage = JSON.parse(readFileSync(path.join(product, "package.json"), "utf8"))
  if (generatedPackage.dependencies["@sapienx/saas-core-cli"] || generatedPackage.dependencies["@sapienx/saas-core-app"]) throw new Error("Tooling/template-only Core packages were emitted as runtime dependencies.")
  if (generatedPackage.devDependencies["@sapienx/saas-core-cli"] !== "^2.0.0") throw new Error("Core CLI was not emitted as a tooling dependency.")
  for (const name of ["@sapienx/saas-core", "@sapienx/saas-core-config", "@sapienx/saas-core-ui"]) if (!generatedPackage.dependencies[name]) throw new Error(`Missing runtime Core dependency: ${name}`)
  run(process.execPath, [packageCli, "doctor", product], root)
  writeFileSync(path.join(product, ".npmrc"), `registry=https://registry.npmjs.org/\n@sapienx:registry=${registryUrl}\n`, "utf8")
  run("npm", ["install", "--ignore-scripts", "--audit=false", "--fund=false"], product)
  const installedCli = path.join(product, "node_modules/.bin/saas-core")
  if (!existsSync(installedCli)) throw new Error("Packed Core CLI was not installed in the generated consumer.")
  run(installedCli, ["doctor", product], product)
  run("npm", ["test"], product)
  run("npm", ["run", "build"], product)
  await bootAndSmoke(product, 3217)
  renameSync(product, relocated)

  const relocatedCli = path.join(relocated, "node_modules/.bin/saas-core")
  run(relocatedCli, ["diff", relocated], relocated)
  run(relocatedCli, ["update", relocated, "--dry-run"], relocated)
  rmSync(path.join(relocated, "node_modules"), { recursive: true, force: true })
  run("npm", ["ci", "--ignore-scripts", "--audit=false", "--fund=false"], relocated)
  if (!existsSync(relocatedCli)) throw new Error("Packed Core CLI was not restored by frozen install.")
  run(relocatedCli, ["doctor", relocated], relocated)
  run("npm", ["test"], relocated)
  run("npm", ["run", "build"], relocated)
  await bootAndSmoke(relocated, 3218)
  run(relocatedCli, ["update", relocated], relocated)
  run(relocatedCli, ["doctor", relocated], relocated)
  const packageJson = JSON.parse(readFileSync(path.join(relocated, "package.json"), "utf8"))
  const persistedPackage = JSON.stringify(packageJson)
  if (/file:|link:|workspace:|registry\.url|\/Users\/|\/private\//.test(persistedPackage) || persistedPackage.includes(root)) throw new Error("Generated consumer contains a local dependency path.")
  console.log(JSON.stringify({ status: "PASS", product: relocated, install: "packed Core through local registry", relocation: true, frozenInstall: true }))
} finally {
  registryProcess.kill("SIGTERM")
  rmSync(product, { recursive: true, force: true })
  rmSync(relocatedParent, { recursive: true, force: true })
  rmSync(npmCache, { recursive: true, force: true })
}
