#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const VERSION = "2.0.0"
const CLI_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CORE_TEMPLATE = path.join(CLI_PACKAGE_ROOT, "template")
const [command = "help", ...args] = process.argv.slice(2)

function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "product"
}

function targetDirectory(value) {
  const directory = value || "."
  return path.resolve(process.cwd(), directory)
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function materializeCoreTemplate(directory, name, slug) {
  await cp(CORE_TEMPLATE, directory, { recursive: true, force: true })
  await writeFile(path.join(directory, "lib/product-config.ts"), `export type ProductConfig = {
  name: string
  slug: string
  logoPath: string
  iconPath: string
  themeColor: string
  description: string
  capabilities: Readonly<Record<string, boolean>>
}

export const PRODUCT_CONFIG: ProductConfig = {
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  logoPath: "/product-mark.svg",
  iconPath: "/product-mark.svg",
  themeColor: "#7c3aed",
  description: ${JSON.stringify(`${name} workspace management, built on SaaS Core.`)},
  capabilities: { billing: true, domains: true, platformControl: true, pushNotifications: true, pwa: true },
}
`, "utf8")
  await writeFile(path.join(directory, "next-env.d.ts"), `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
`, "utf8")
  await writeFile(path.join(directory, ".env.example"), `# Copy to .env.local. Secret values remain server-only.
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PADDLE_ENVIRONMENT=sandbox
PADDLE_API_KEY=
PADDLE_WEBHOOK_SECRET=
PADDLE_CRON_SECRET=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:ops@example.com
`, "utf8")
  await writeFile(path.join(directory, "supabase/config.toml"), `project_id = ${JSON.stringify(slug)}

[api]
enabled = true
port = 54321

[db]
port = 54322

[studio]
enabled = true
port = 54323

[inbucket]
enabled = true
port = 54324
`, "utf8")
}

async function init() {
  const name = args[0]
  if (!name) throw new Error("Usage: saas-core init <product-name> [directory]")
  const slug = slugify(name)
  const directory = targetDirectory(args[1] || slug)
  await mkdir(directory, { recursive: true })
  await materializeCoreTemplate(directory, name, slug)
  await mkdir(path.join(directory, "src"), { recursive: true })
  await writeJson(path.join(directory, "package.json"), {
    name: slug,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { dev: "next dev", build: "next build", start: "next start", typecheck: "tsc --noEmit", test: "vitest run && node src/product-domain.mjs" },
    dependencies: { "@saas-core/app": "^2.0.0", "@saas-core/core": "^2.0.0" },
  })
  await writeJson(path.join(directory, ".saas-core-manifest.json"), {
    coreVersion: VERSION,
    product: { name, slug },
    ownership: { core: ["auth", "workspace", "billing", "platform", "ui"], product: ["src"] },
  })
  await writeFile(path.join(directory, "src/product-domain.mjs"), `import { defineProductConfig } from "@saas-core/core"\n\nexport const product = defineProductConfig({ name: ${JSON.stringify(name)}, slug: ${JSON.stringify(slug)} })\nconsole.log(\`Initialized \${product.name} on SaaS Core \${product.slug}.\`)\n`, "utf8")
  await writeFile(path.join(directory, "README.md"), `# ${name}\n\nA product built on SaaS Core. The generated app includes the source-derived auth, workspace, team, plan, setup, settings, PWA and Platform Control surfaces. Add domain tables and workflows beneath the Workspace boundary.\n`, "utf8")
  await writeFile(path.join(directory, ".gitignore"), "node_modules/\n", "utf8")
  console.log(`Created portable SaaS Core product at ${path.relative(process.cwd(), directory) || "."}.`)
}

async function readConsumer() {
  const directory = targetDirectory(args[0])
  const manifest = JSON.parse(await readFile(path.join(directory, ".saas-core-manifest.json"), "utf8"))
  const packageJson = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"))
  return { directory, manifest, packageJson }
}

async function doctor() {
  const { directory, manifest, packageJson } = await readConsumer()
  const serialized = JSON.stringify(packageJson)
  const invalid = ["file:", "/Users/", "/private/", "\\\\"]
  if (invalid.some((value) => serialized.includes(value))) throw new Error("Consumer contains a non-portable dependency or machine path.")
  if (manifest.coreVersion !== VERSION) throw new Error(`Consumer targets Core ${manifest.coreVersion}; expected ${VERSION}.`)
  await readFile(path.join(directory, "src/product-domain.mjs"), "utf8")
  console.log(`Doctor passed for ${path.relative(process.cwd(), directory) || "."}: portable manifest, product boundary, and Core version ${VERSION}.`)
}

async function diff() {
  const { directory, manifest } = await readConsumer()
  const status = manifest.coreVersion === VERSION ? "up to date" : `Core ${manifest.coreVersion} → ${VERSION}`
  console.log(`${path.relative(process.cwd(), directory) || "."}: ${status}.`)
}

async function update() {
  const { directory, manifest } = await readConsumer()
  manifest.coreVersion = VERSION
  await writeJson(path.join(directory, ".saas-core-manifest.json"), manifest)
  console.log(`Updated Core manifest at ${path.relative(process.cwd(), directory) || "."}.`)
}

function help() {
  console.log("Usage: saas-core <init|doctor|diff|update> [args]")
}

try {
  if (command === "init") await init()
  else if (command === "doctor") await doctor()
  else if (command === "diff") await diff()
  else if (command === "update") await update()
  else help()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
