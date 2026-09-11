import { spawnSync } from "node:child_process"
import { createReleaseUnitEnvironment } from "./release-environment.mjs"

const result = spawnSync("./node_modules/.bin/vitest", ["run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: createReleaseUnitEnvironment(process.env),
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
