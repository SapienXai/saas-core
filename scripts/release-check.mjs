import { spawnSync } from "node:child_process"

const checks = [
  ["lint", ["pnpm", "lint"]],
  ["typecheck", ["pnpm", "typecheck"]],
  ["unit", ["pnpm", "test"]],
  ["build", ["pnpm", "build"]],
  ["pack", ["pnpm", "pack:all"]],
  ["cli", ["pnpm", "test:cli"]],
]

let failed = false
for (const [label, command] of checks) {
  process.stdout.write(`\n[release:check] ${label}\n`)
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", env: process.env })
  if (result.status !== 0) failed = true
}

console.log("\n[release:check] deterministic release checks complete")
console.log("[release:check] local Supabase, browser, and live-provider checks run separately when their environments are available")
if (failed) process.exitCode = 1
