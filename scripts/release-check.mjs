import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"
import { createBuildEnvironment, createReleaseToolingEnvironment } from "./release-environment.mjs"

const releaseEnvironment = createReleaseToolingEnvironment(process.env)

function run(label, args, env = releaseEnvironment) {
  console.log(`\n==> ${label}`)
  const result = spawnSync("pnpm", args, { stdio: "inherit", env })
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 1}.`)
}

const nextEnvFile = "next-env.d.ts"
const nextEnvBeforeBuild = existsSync(nextEnvFile) ? readFileSync(nextEnvFile, "utf8") : null

run("frozen install", ["install", "--frozen-lockfile"])
run("repository hygiene", ["run", "repo:hygiene"])
run("repository hygiene failure-path test", ["run", "repo:hygiene:test"])
run("release metadata", ["run", "release:metadata"])
run("release workflow contract", ["run", "release:workflow-contract"])
run("release environment isolation", ["run", "release:environment"])
run("lint", ["run", "lint"])
run("typecheck", ["run", "typecheck"])
run("unit tests", ["run", "release:unit"])
run("local Supabase start", ["run", "db:start:ci"])
run("clean local integration tests", ["run", "db:test:clean"])
run("schema tests", ["run", "db:test:schema"])
const generatedTypesBefore = readFileSync("types/supabase.ts", "utf8")
run("generated database types", ["run", "db:types"])
if (readFileSync("types/supabase.ts", "utf8") !== generatedTypesBefore) throw new Error("db:types is not deterministic; regenerate and review types/supabase.ts before release.")
run("schema doctor", ["run", "core:doctor-schema"])
run("catalog contract", ["run", "core:catalog"])
run("genericity scan", ["run", "core:scan"])
run("commercial ownership scan", ["run", "core:commercial-scan"])
run("UI source fidelity", ["run", "core:ui-fidelity"])
run("root/template source parity", ["run", "core:source-parity"])
run("fresh consumer contract", ["run", "core:consumer-contract"])
run("Core lifecycle proof", ["run", "core:lifecycle"])
run("application build", ["run", "build"], createBuildEnvironment(process.env))
if (nextEnvBeforeBuild !== null && readFileSync(nextEnvFile, "utf8") !== nextEnvBeforeBuild) writeFileSync(nextEnvFile, nextEnvBeforeBuild, "utf8")
run("auth E2E setup", ["run", "auth:e2e"])

if (existsSync(chromium.executablePath())) {
  run("critical browser E2E", ["run", "e2e:critical"])
} else if (process.env.RELEASE_ALLOW_E2E_SKIP === "1") {
  console.warn("Critical browser E2E skipped explicitly: Playwright Chromium is not installed.")
} else {
  throw new Error("Critical browser E2E is required for release:check; install Playwright Chromium or set RELEASE_ALLOW_E2E_SKIP=1 with an explicit release exception.")
}

run("package packing", ["run", "core:pack"])
run("package tarball inspection", ["run", "release:packages"])
run("artifact lifecycle proof", ["run", "release:artifact-lifecycle"])
run("partial publication recovery proof", ["run", "release:recovery-proof"])
run("fresh and upgrade consumer proof", ["run", "core:consumer-proof"])
console.log(JSON.stringify({ status: "PASS", browserE2E: existsSync(chromium.executablePath()) ? "passed" : "explicitly-skipped" }))
