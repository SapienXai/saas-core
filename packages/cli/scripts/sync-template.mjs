import { cp, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = path.resolve(cliRoot, "../app/template")
const destination = path.join(cliRoot, "template")
const appManifest = path.join(cliRoot, "app-package.json")

await rm(destination, { recursive: true, force: true })
await cp(source, destination, { recursive: true })
await rm(path.join(destination, "supabase/.branches"), { recursive: true, force: true })
await rm(path.join(destination, "supabase/.temp"), { recursive: true, force: true })
await rm(path.join(destination, "supabase/.gitignore"), { force: true })
await cp(path.join(cliRoot, "../app/package.json"), appManifest)
