import { mkdir } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"

const destination = path.resolve(process.cwd(), process.argv.find((value) => value !== "--" && value !== process.argv[0] && value !== process.argv[1]) || "artifacts")
await mkdir(destination, { recursive: true })

for (const packageName of ["@saas-core/core", "@saas-core/config", "@saas-core/ui", "@saas-core/app", "@saas-core/cli"]) {
  const result = spawnSync("pnpm", ["--filter", packageName, "pack", "--pack-destination", destination], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(`Packed Core packages into ${path.relative(process.cwd(), destination) || "."}.`)
