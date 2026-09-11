import { mkdir, rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"

const destination = path.resolve(process.cwd(), process.argv.find((value) => value !== "--" && value !== process.argv[0] && value !== process.argv[1]) || "artifacts")
await mkdir(destination, { recursive: true })

const packageNames = PACKAGE_NAMES
for (const packageName of packageNames) {
  const filename = `${packageName.replace(/^@/, "").replace("/", "-")}-${RELEASE_VERSION}.tgz`
  await rm(path.join(destination, filename), { force: true })
}
for (const packageName of packageNames) {
  if (packageName !== "@sapienx/saas-core-app" && packageName !== "@sapienx/saas-core-cli") {
    const build = spawnSync("pnpm", ["--filter", packageName, "build"], { stdio: "inherit" })
    if (build.status !== 0) process.exit(build.status ?? 1)
  }
  const result = spawnSync("pnpm", ["--filter", packageName, "pack", "--pack-destination", destination], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(`Packed Core packages into ${path.relative(process.cwd(), destination) || "."}.`)
