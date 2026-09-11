import { spawnSync } from "node:child_process"
import { createReleaseToolingEnvironment } from "./release-environment.mjs"

const result = spawnSync("pnpm", ["exec", "supabase", "start", "--workdir", "."], {
  env: { ...createReleaseToolingEnvironment(process.env), SUPABASE_TELEMETRY_DISABLED: "1" },
  stdio: "ignore",
})

if (result.error) {
  console.error(`Supabase Docker start failed: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`Supabase Docker start failed with exit code ${result.status ?? 1}.`)
  process.exit(result.status ?? 1)
}

console.log("Supabase Docker services started successfully.")
