import { readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const template = path.join(root, "packages/app/template")
const sharedCapabilityFiles = [
  "lib/platform-admin.ts",
  "app/platform/users/page.tsx",
  "app/platform/users/actions.ts",
  "components/platform/platform-user-management.tsx",
  "components/platform/platform-plan-management.tsx",
]

for (const relative of sharedCapabilityFiles) {
  const rootFile = path.join(root, relative)
  const templateFile = path.join(template, relative)
  let rootSource
  let templateSource
  try {
    ;[rootSource, templateSource] = await Promise.all([readFile(rootFile, "utf8"), readFile(templateFile, "utf8")])
  } catch (error) {
    throw new Error(`Root/template capability file is missing: ${relative} (${error instanceof Error ? error.message : String(error)})`)
  }
  if (rootSource !== templateSource) throw new Error(`Root/template capability drift detected: ${relative}`)
}

console.log(`Root/template capability parity passed for ${sharedCapabilityFiles.length} shared platform files.`)
