import { spawnSync } from "node:child_process"

const result = spawnSync(process.execPath, ["packages/cli/bin/saas-core.mjs", "doctor", ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(result.status ?? 1)
