import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
await rm(path.join(cliRoot, "template"), { recursive: true, force: true })
await rm(path.join(cliRoot, "app-package.json"), { force: true })
