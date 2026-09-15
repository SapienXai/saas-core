#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const MAX_TRACKED_FILE_BYTES = 1_048_576
// Add an exact, reviewed path here only when a legitimate source asset needs
// to exceed the default guard. Never allow a directory or a filename pattern.
export const LARGE_FILE_ALLOWLIST = new Set()

const FORBIDDEN_PATH_RULES = [
  { pattern: /(?:^|\/)node_modules(?:\/|$)/, reason: "dependency installation state" },
  { pattern: /(?:^|\/)(?:\.next|\.next-e2e|\.turbo|\.cache|\.pnpm-store)(?:\/|$)/, reason: "framework, build, or package-manager cache" },
  { pattern: /(?:^|\/)(?:coverage|playwright-report|test-results)(?:\/|$)/, reason: "test or browser output" },
  { pattern: /^(?:out|build|dist|artifacts|output|tmp|temp)(?:\/|$)/, reason: "root-generated build or artifact output" },
  { pattern: /^packages\/[^/]+\/(?:out|build|dist)(?:\/|$)/, reason: "package-generated build output" },
  { pattern: /^(?:local-registry|package-inspection|consumer-proof|packed-consumer)(?:\/|$)/, reason: "temporary package or consumer proof state" },
  { pattern: /(?:^|\/)\.playwright-cli(?:\/|$)/, reason: "browser automation runtime state" },
  { pattern: /(?:^|\/)supabase\/(?:\.branches|\.temp)(?:\/|$)/, reason: "local Supabase runtime state" },
  { pattern: /^(?:\.saas-core-backups|\.reference)(?:\/|$)/, reason: "local update backup or reference state" },
  { pattern: /(?:^|\/)(?:\.idea|\.vscode)(?:\/|$)/, reason: "editor state" },
]

const SOURCE_PREFIXES = [
  "packages/core/src/",
  "packages/config/src/",
  "packages/ui/src/",
  "packages/app/template/",
  "packages/cli/bin/",
  "packages/cli/scripts/",
]

const TEXT_FILE_EXTENSIONS = new Set([
  "bash",
  "bat",
  "cfg",
  "cmd",
  "command",
  "conf",
  "cjs",
  "css",
  "csv",
  "diff",
  "env",
  "gql",
  "graphql",
  "hcl",
  "html",
  "ini",
  "js",
  "json",
  "jsonc",
  "lock",
  "md",
  "mdx",
  "mjs",
  "patch",
  "pem",
  "prisma",
  "properties",
  "ps1",
  "rb",
  "scss",
  "sh",
  "sql",
  "svg",
  "svelte",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "webmanifest",
  "xml",
  "xsd",
  "yaml",
  "yml",
  "zsh",
])
const TEXT_FILE_BASENAMES = new Set([
  ".env",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  "agents",
  "brewfile",
  "claude",
  "dockerfile",
  "gemfile",
  "license",
  "makefile",
  "procfile",
  "rakefile",
  "vagrantfile",
])
const TEXT_FILE_PREFIXES = [".github/", "bin/", "config/", "scripts/", "supabase/"]
export const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024
const CODE_FILE = /\.(?:[cm]?[jt]sx?|mjs|cjs|json)$/i
const MACHINE_LOCAL_REFERENCE = /\/(?:Users|private\/var|var\/folders)\/[^\s"'`]+/
const GENERATED_LOCAL_IMPORT = /(?:from\s+|import\s*\(|require\s*\()\s*["'`][^"'`]*(?:\.next|node_modules|artifacts|output|test-results|playwright-report|\.playwright-cli)(?:[\/\\]|$)/i
const SECRET_RULES = [
  { pattern: /-----BEGIN (?:[A-Z0-9][A-Z0-9 _-]* )?PRIVATE KEY-----/, reason: "private key material" },
  { pattern: /\b(?:gh[pousr]_|github_pat_|xox[baprs]-|sk_(?:live|test)_|rk_(?:live|test)_|sk-(?:proj|svcacct)-|whsec_)[A-Za-z0-9_-]{16,}\b/, reason: "high-confidence access token" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: "AWS access key" },
]
const TOKEN_PREFIX = /^(?:gh[pousr]_|github_pat_|xox[baprs]-|sk_(?:live|test)_|rk_(?:live|test)_|sk-(?:proj|svcacct)-|whsec_)/i
const PLACEHOLDER_SEGMENT = "(?:change[-_]?me|changeme|dummy|example|fake|placeholder|replace[-_]?me|sample|todo|token|your(?:[-_][a-z0-9]+)+)"
const PLACEHOLDER_TOKEN = new RegExp(`^(?:${PLACEHOLDER_SEGMENT})(?:[-_]${PLACEHOLDER_SEGMENT})*$`, "i")

function normalize(relative) {
  return relative.replaceAll(path.sep, "/").replaceAll("\\", "/").replace(/^\.\//, "")
}

function basename(relative) {
  return normalize(relative).split("/").at(-1) || ""
}

function isExampleEnvironmentFile(relative) {
  return /^\.env(?:\.[^.]+)*\.example$/.test(basename(relative))
}

function isLocalEnvironmentFile(relative) {
  const name = basename(relative)
  return name === ".env" || (name.startsWith(".env.") && !isExampleEnvironmentFile(relative))
}

export function isLikelyTextFile(relative) {
  const file = normalize(relative)
  const name = basename(file).toLowerCase()
  if (TEXT_FILE_BASENAMES.has(name) || /^\.env(?:\.|$)/i.test(name)) return true
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : ""
  if (TEXT_FILE_EXTENSIONS.has(extension)) return true
  return !extension && TEXT_FILE_PREFIXES.some((prefix) => file.toLowerCase().startsWith(prefix))
}

function matchesSecretRule(content, rule) {
  const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`)
  return [...content.matchAll(pattern)].some((match) => {
    const value = match[0]
    if (rule.reason !== "high-confidence access token") return true
    const suffix = value.replace(TOKEN_PREFIX, "")
    return !PLACEHOLDER_TOKEN.test(suffix)
  })
}

function addViolation(violations, file, reason) {
  if (!violations.some((item) => item.file === file && item.reason === reason)) violations.push({ file, reason })
}

export function findPathViolations(relative) {
  const file = normalize(relative)
  const violations = []

  for (const rule of FORBIDDEN_PATH_RULES) if (rule.pattern.test(file)) addViolation(violations, file, rule.reason)
  if (file === "packages/cli/app-package.json" || file.startsWith("packages/cli/template/")) addViolation(violations, file, "CLI pack-time generated source")
  if (file === ".DS_Store" || file.endsWith("/.DS_Store") || file === "Thumbs.db" || file.endsWith("/Thumbs.db") || file === "desktop.ini" || file.endsWith("/desktop.ini")) addViolation(violations, file, "operating-system metadata")
  if (isLocalEnvironmentFile(file)) addViolation(violations, file, "local environment or credential file")
  if (/\.(?:tgz|log|pid|sqlite|sqlite3|db|dump|sql\.gz|pem|key|p12|pfx|crt)$/i.test(file)) addViolation(violations, file, "local artifact, credential, certificate, or database file")
  if (/(?:^|\/)(?:screenshots?|traces?|videos?)(?:\/|$)/i.test(file)) addViolation(violations, file, "browser evidence output")
  if (file.endsWith("/.npmrc") || file === ".npmrc") addViolation(violations, file, "machine-specific package-manager configuration")

  return violations
}

function isSourceFile(relative) {
  const file = normalize(relative)
  return SOURCE_PREFIXES.some((prefix) => file.startsWith(prefix)) && CODE_FILE.test(file)
}

export function findContentViolations(relative, content) {
  const file = normalize(relative)
  const violations = findSecretViolations(file, content)
  if (isSourceFile(file)) {
    if (MACHINE_LOCAL_REFERENCE.test(content)) addViolation(violations, file, "machine-local absolute path")
    if (GENERATED_LOCAL_IMPORT.test(content)) addViolation(violations, file, "import from generated or local runtime state")
  }
  if (file.endsWith("/package.json") || file === "package.json") {
    try {
      const packageJson = JSON.parse(content)
      const dependencies = Object.values({
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies,
        ...packageJson.peerDependencies,
      })
      if (dependencies.some((value) => typeof value === "string" && /^(?:file:|link:|\/(?:Users|private|var|tmp)(?:\/|$)|[A-Za-z]:[\\/]|~[\\/])/.test(value))) addViolation(violations, file, "package dependency points to local machine state")
    } catch {
      addViolation(violations, file, "invalid package manifest")
    }
  }
  return violations
}

export function findSecretViolations(relative, content) {
  const file = normalize(relative)
  const violations = []
  for (const rule of SECRET_RULES) if (matchesSecretRule(content, rule)) addViolation(violations, file, rule.reason)
  return violations
}

export function getTrackedFiles(root) {
  const output = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" })
  const deleted = new Set(execFileSync("git", ["-C", root, "ls-files", "--deleted", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean))
  return output.split("\0").filter((file) => file && !deleted.has(file))
}

export function inspectTrackedFiles({ root, files = getTrackedFiles(root), maxBytes = MAX_TRACKED_FILE_BYTES, largeFileAllowlist = LARGE_FILE_ALLOWLIST } = {}) {
  const violations = []
  for (const relative of files) {
    const file = normalize(relative)
    violations.push(...findPathViolations(file))
    const absolute = path.join(root, file)
    if (!existsSync(absolute)) continue
    const stats = lstatSync(absolute)
    if (stats.isFile() && stats.size > maxBytes && !largeFileAllowlist.has(file)) addViolation(violations, file, `tracked file is ${stats.size} bytes; maximum is ${maxBytes} bytes`)
    if (!stats.isFile() || stats.size > MAX_TEXT_SCAN_BYTES || !isLikelyTextFile(file)) continue
    const bytes = readFileSync(absolute)
    if (bytes.includes(0)) continue
    violations.push(...findContentViolations(file, bytes.toString("utf8")))
  }
  const unique = [...new Map(violations.map((item) => [`${item.file}\0${item.reason}`, item])).values()]
  return { trackedFiles: files.length, maxBytes, violations: unique }
}

function parseArgs(values) {
  const options = { root: process.cwd(), json: false, maxBytes: MAX_TRACKED_FILE_BYTES }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--json") options.json = true
    else if (value === "--root") options.root = path.resolve(values[++index] || "")
    else if (value.startsWith("--root=")) options.root = path.resolve(value.slice("--root=".length))
    else if (value === "--max-bytes") options.maxBytes = Number(values[++index])
    else if (value.startsWith("--max-bytes=")) options.maxBytes = Number(value.slice("--max-bytes=".length))
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!Number.isInteger(options.maxBytes) || options.maxBytes <= 0) throw new Error("--max-bytes must be a positive integer.")
  return options
}

export function runRepositoryHygiene(options = {}) {
  const root = path.resolve(options.root || process.cwd())
  const result = inspectTrackedFiles({ root, maxBytes: options.maxBytes || MAX_TRACKED_FILE_BYTES })
  if (result.violations.length) {
    const lines = result.violations.map(({ file, reason }) => `- ${file}: ${reason}`)
    const error = new Error(`Repository hygiene failed with ${result.violations.length} violation(s).\n${lines.join("\n")}`)
    error.result = result
    throw error
  }
  return result
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = runRepositoryHygiene(options)
  const output = { status: "PASS", trackedFiles: result.trackedFiles, maxTrackedFileBytes: result.maxBytes, violations: 0 }
  if (options.json) console.log(JSON.stringify(output, null, 2))
  else console.log(JSON.stringify(output))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
