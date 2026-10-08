import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { DEFAULT_PRODUCT_OWNED_PATHS, PRODUCT_FILES, PRODUCT_PREFIXES } from "../packages/cli/bin/ownership.mjs"
import { RELEASE_VERSION, RUNTIME_PACKAGES, SCHEMA_VERSION, TOOLING_PACKAGES } from "./release-constants.mjs"

const root = process.cwd()
const cli = path.join(root, "packages/cli/bin/saas-core.mjs")
const template = path.join(root, "packages/app/template")
const fixture = await mkdtemp(path.join(os.tmpdir(), "saas-core-consumer-contract-"))
const product = path.join(fixture, "contract-product")

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function run(args, extraEnvironment = {}) {
  const environment = {
    ...process.env,
    SAAS_CORE_TEMPLATE: template,
    ...extraEnvironment,
  }
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: environment, encoding: "utf8" })
  return result
}

function parseJson(result, label, expectedStatus = 0) {
  assert(result.status === expectedStatus, `${label} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`)
  try { return JSON.parse(result.stdout) } catch (error) { throw new Error(`${label} did not return JSON: ${error instanceof Error ? error.message : String(error)}\n${result.stdout}`) }
}

try {
  const init = run(["init", "Contract Demo", product])
  assert(init.status === 0, `fresh saas-core init failed: ${init.stderr || init.stdout}`)

  const contractFiles = ["README.md", "AGENTS.md", ".env.example", ".gitignore"]
  for (const relative of contractFiles) {
    const file = path.join(product, relative)
    assert(existsSync(file), `fresh consumer is missing ${relative}`)
    const content = await readFile(file, "utf8")
    assert(!content.includes("__PRODUCT_NAME__") && !content.includes("__PRODUCT_SLUG__"), `${relative} contains an unresolved product placeholder`)
  }
  const readme = await readFile(path.join(product, "README.md"), "utf8")
  const agents = await readFile(path.join(product, "AGENTS.md"), "utf8")
  const gitignore = await readFile(path.join(product, ".gitignore"), "utf8")
  assert(readme.startsWith("# Contract Demo\n"), "generated README is not dynamic")
  for (const phrase of ["pnpm db:start", "pnpm db:types", "billing:sync-catalog", "workspace_id", "source-only", "supabase/migrations/", "exact migration paths"]) assert(readme.includes(phrase), `generated README is missing ${phrase}`)
  for (const phrase of ["Product implementation rules", "Verification contract", "workspace_id", "server-only", "BEGIN:nextjs-agent-rules", "unknown flat migrations remain Product-owned"]) assert(agents.includes(phrase), `generated AGENTS.md is missing ${phrase}`)
  for (const phrase of [".next/", ".playwright-cli/", "supabase/.temp/", "*.tgz", "!.env.example"]) assert(gitignore.includes(phrase), `generated .gitignore is missing ${phrase}`)
  const canonicalEnvironment = await readFile(path.join(template, ".env.example"), "utf8")
  const cliEnvironment = await readFile(path.join(root, "packages/cli/templates/.env.example"), "utf8")
  assert(cliEnvironment === canonicalEnvironment, "CLI fallback .env.example drifted from the canonical template")

  const packageJson = JSON.parse(await readFile(path.join(product, "package.json"), "utf8"))
  assert(packageJson.packageManager === "pnpm@11.21.0", "generated consumer did not inherit the supported package manager")
  assert(packageJson.engines?.node === ">=24.0.0 <25" && packageJson.engines?.pnpm === ">=11.21.0 <12", "generated consumer did not inherit the supported engines")
  for (const name of RUNTIME_PACKAGES) assert(packageJson.dependencies?.[name] === `^${RELEASE_VERSION}`, `missing runtime package ${name}`)
  for (const name of TOOLING_PACKAGES) assert(packageJson.devDependencies?.[name] === `^${RELEASE_VERSION}`, `missing tooling package ${name}`)
  for (const name of ["typescript", "eslint", "vitest", "supabase", "tailwindcss"]) {
    assert(!packageJson.dependencies?.[name] && packageJson.devDependencies?.[name], `${name} must be a consumer devDependency`)
  }
  for (const script of ["lint", "typecheck", "test:run", "db:start", "db:stop", "db:reset", "db:types", "billing:sync-catalog", "verify", "saas-core:doctor", "saas-core:diff", "saas-core:update", "saas-core:update:dry-run"]) {
    assert(typeof packageJson.scripts?.[script] === "string", `generated consumer is missing script ${script}`)
  }

  const manifest = JSON.parse(await readFile(path.join(product, ".saas-core-manifest.json"), "utf8"))
  assert(manifest.coreVersion === RELEASE_VERSION && manifest.schemaVersion === SCHEMA_VERSION, "generated manifest coordinates are incorrect")
  for (const relative of DEFAULT_PRODUCT_OWNED_PATHS) assert(manifest.productOwnedPaths.includes(relative), `manifest is missing product ownership ${relative}`)
  for (const relative of DEFAULT_PRODUCT_OWNED_PATHS) assert(!manifest.managedFiles?.[relative], `product-owned path was recorded as managed: ${relative}`)
  assert(existsSync(path.join(product, "types/supabase.ts")), "generated consumer is missing its product-owned type snapshot")

  const migrations = (await readdir(path.join(template, "supabase/migrations"))).filter((relative) => relative.endsWith(".sql"))
  assert(migrations.length > 0, "canonical template has no direct migration sources")
  for (const relative of migrations) {
    const migration = `supabase/migrations/${relative}`
    assert(manifest.managedFiles?.[migration], `manifest did not record Core migration ${migration}`)
    assert(existsSync(path.join(product, migration)), `consumer is missing Core migration ${migration}`)
  }

  const productMigrationRelative = "supabase/migrations/20990909000000_product-owned-contract-proof.sql"
  await writeFile(path.join(product, productMigrationRelative), "create table if not exists public.product_owned_contract_proof (id uuid primary key);\n", "utf8")
  const nonCanonicalMigrationRelative = "supabase/migrations/foo/20990909000001_unknown-nested.sql"
  const deepNonCanonicalMigrationRelative = "supabase/migrations/foo/bar/20990900000002_unknown-deep-nested.sql"
  const nonCanonicalMigrationContent = "-- Unsupported nested migration fixture; preserved without native execution claims.\n"
  const deepNonCanonicalMigrationContent = "-- Unsupported deep nested migration fixture; preserved without native execution claims.\n"
  for (const [relative, content] of [[nonCanonicalMigrationRelative, nonCanonicalMigrationContent], [deepNonCanonicalMigrationRelative, deepNonCanonicalMigrationContent]]) {
    await mkdir(path.dirname(path.join(product, relative)), { recursive: true })
    await writeFile(path.join(product, relative), content, "utf8")
  }

  const doctor = parseJson(run(["doctor", product, "--json"], {
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_ANON_KEY: "",
  }), "consumer doctor")
  assert(doctor.errors === 0, "fresh consumer doctor reported a structural error")
  assert(doctor.warnings >= 1 && doctor.checks.some((item) => item.category === "DATABASE" && item.status === "WARNING"), "doctor did not distinguish unavailable database credentials as a warning")
  assert(doctor.checks.some((item) => item.category === "PRODUCT" && item.detail.includes("Product-owned migration(s)")), "fresh doctor did not report the flat Product migration as Product-owned")
  for (const relative of [nonCanonicalMigrationRelative, deepNonCanonicalMigrationRelative]) assert(doctor.checks.some((item) => item.category === "MIGRATION" && item.status === "WARNING" && item.detail.includes(relative)), `fresh doctor did not report ${relative} as a noncanonical nested migration`)

  const diff = parseJson(run(["diff", product, "--json"]), "consumer diff")
  assert(diff.coreDrift.length === 0 && diff.versionDrift.length === 0 && diff.packageDrift.length === 0 && diff.schemaDrift.length === 0, "fresh consumer has unexpected Core drift")
  assert(diff.productMigrationsIgnored.includes(productMigrationRelative), "fresh diff did not preserve the flat Product migration")
  for (const relative of [nonCanonicalMigrationRelative, deepNonCanonicalMigrationRelative]) assert(diff.nonCanonicalMigrations.includes(relative), `fresh diff did not preserve ${relative} as noncanonical`)
  const dryRun = parseJson(run(["update", product, "--dry-run", "--json"]), "consumer update dry-run")
  for (const relative of [nonCanonicalMigrationRelative, deepNonCanonicalMigrationRelative]) {
    assert(dryRun.nonCanonicalMigrations.includes(relative), `fresh update dry-run did not preserve ${relative} as noncanonical`)
    assert(!dryRun.added.includes(relative) && !dryRun.updated.includes(relative) && !dryRun.removed.includes(relative), `fresh update dry-run proposed a mutation for ${relative}`)
  }

  const ownershipDoc = await readFile(path.join(root, "docs/OWNERSHIP.md"), "utf8")
  for (const relative of [...PRODUCT_PREFIXES, ...PRODUCT_FILES]) assert(ownershipDoc.includes(`\`${relative}`) || ownershipDoc.includes(`\`${relative}**`), `ownership documentation omitted ${relative}`)
  for (const phrase of ["direct-child", "noncanonical", "not assumed to"]) assert(ownershipDoc.includes(phrase), `ownership documentation is missing ${phrase}`)
  assert((await readFile(path.join(root, "packages/cli/templates/README.md"), "utf8")) === (await readFile(path.join(template, "README.md"), "utf8")), "CLI fallback README drifted from the canonical template")
  assert((await readFile(path.join(root, "packages/cli/templates/AGENTS.md"), "utf8")) === (await readFile(path.join(template, "AGENTS.md"), "utf8")), "CLI fallback AGENTS drifted from the canonical template")
  assert((await readFile(path.join(root, "packages/cli/templates/consumer.gitignore"), "utf8")) === (await readFile(path.join(template, "consumer.gitignore"), "utf8")), "CLI fallback consumer ignore drifted from the canonical template")

  console.log(JSON.stringify({ status: "PASS", consumer: "fresh CLI init", release: RELEASE_VERSION, schema: SCHEMA_VERSION, contractFiles, migrationSources: migrations.length, databaseCheck: "warning without credentials", ownership: "CLI module and docs aligned" }, null, 2))
} finally {
  await rm(fixture, { recursive: true, force: true })
}
