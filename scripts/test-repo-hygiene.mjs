import { execFileSync, spawnSync } from "node:child_process"
import { inspectTrackedFiles, LARGE_FILE_ALLOWLIST, MAX_TRACKED_FILE_BYTES } from "./repo-hygiene.mjs"
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = process.cwd()
const fixture = mkdtempSync(path.join(os.tmpdir(), "saas-core-repo-hygiene-"))
const checker = path.join(root, "scripts/repo-hygiene.mjs")
const results = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runChecker() {
  return spawnSync(process.execPath, [checker, "--root", fixture], { encoding: "utf8" })
}

function clearFixture() {
  for (const entry of readdirSync(fixture)) if (entry !== ".git") rmSync(path.join(fixture, entry), { recursive: true, force: true })
}

function writeFixture(relative, content) {
  const absolute = path.join(fixture, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function trackFixture() {
  execFileSync("git", ["-C", fixture, "add", "-A"])
}

function record(name) {
  results.push({ name, status: "PASS" })
}

function runFailureCase(name, setup, expectedFile, expectedReason, secretValues = []) {
  clearFixture()
  setup()
  trackFixture()
  const failed = runChecker()
  const output = `${failed.stdout || ""}\n${failed.stderr || ""}`
  assert(failed.status !== 0 && failed.status !== null, `${name}: repo:hygiene accepted an invalid fixture`)
  assert(output.includes(`${expectedFile}:`), `${name}: repo:hygiene did not identify ${expectedFile}`)
  assert(output.includes(expectedReason), `${name}: repo:hygiene did not report ${expectedReason}`)
  for (const secret of secretValues) assert(!output.includes(secret), `${name}: repo:hygiene leaked a secret value`)
  record(name)
}

function runCleanCase(name, setup) {
  clearFixture()
  setup()
  trackFixture()
  const passed = runChecker()
  assert(passed.status === 0, `${name}: repo:hygiene rejected a clean fixture: ${passed.stderr || passed.stdout}`)
  const summary = JSON.parse(passed.stdout)
  assert(summary.status === "PASS", `${name}: repo:hygiene result was not PASS`)
  record(name)
}

try {
  execFileSync("git", ["-C", fixture, "init", "--quiet"])

  runFailureCase(
    "runtime artifact",
    () => writeFixture(".next/cache.js", "generated\n"),
    ".next/cache.js",
    "framework, build, or package-manager cache",
  )
  runFailureCase(
    "browser runtime artifact",
    () => writeFixture(".playwright-cli/page.yml", "runtime\n"),
    ".playwright-cli/page.yml",
    "browser automation runtime state",
  )
  runFailureCase(
    "package artifact",
    () => writeFixture("artifacts/package.tgz", "artifact\n"),
    "artifacts/package.tgz",
    "root-generated build or artifact output",
  )
  runFailureCase(
    "root build output",
    () => writeFixture("build/generated.js", "generated\n"),
    "build/generated.js",
    "root-generated build or artifact output",
  )
  runFailureCase(
    "root temporary output",
    () => writeFixture("tmp/proof.txt", "temporary\n"),
    "tmp/proof.txt",
    "root-generated build or artifact output",
  )

  const sourceToken = `gh${"p_"}${"A".repeat(36)}`
  runFailureCase(
    "real-looking secret in normal source",
    () => writeFixture("src/config.ts", `export const token = ${JSON.stringify(sourceToken)}\n`),
    "src/config.ts",
    "high-confidence access token",
    [sourceToken],
  )

  const environmentToken = `sk_${"live_"}${"B".repeat(32)}`
  runFailureCase(
    "real-looking secret in example environment",
    () => writeFixture(".env.example", `STRIPE_SECRET_KEY=${environmentToken}\n`),
    ".env.example",
    "high-confidence access token",
    [environmentToken],
  )

  const nestedEnvironmentToken = `rk_${"live_"}${"E".repeat(32)}`
  runFailureCase(
    "real-looking secret in nested example environment",
    () => writeFixture(".env.production.example", `RENEWAL_KEY=${nestedEnvironmentToken}\n`),
    ".env.production.example",
    "high-confidence access token",
    [nestedEnvironmentToken],
  )

  const markdownToken = `xoxb${"-"}${"C".repeat(24)}`
  runFailureCase(
    "real-looking secret in Markdown",
    () => writeFixture("docs/setup.md", `Use this credential: ${markdownToken}\n`),
    "docs/setup.md",
    "high-confidence access token",
    [markdownToken],
  )

  const extensionlessToken = `AKIA${"D".repeat(16)}`
  runFailureCase(
    "real-looking secret in extensionless script",
    () => writeFixture("scripts/release-helper", `AWS_ACCESS_KEY_ID=${extensionlessToken}\n`),
    "scripts/release-helper",
    "AWS access key",
    [extensionlessToken],
  )

  const privateKeyMarker = ["-----BEGIN ", "PRIVATE KEY", "-----"].join("")
  runFailureCase(
    "private-key marker",
    () => writeFixture("config/credentials.txt", `${privateKeyMarker}\n`),
    "config/credentials.txt",
    "private key material",
    [privateKeyMarker],
  )

  const webhookToken = `whsec_${"F".repeat(32)}`
  runFailureCase(
    "real-looking Stripe webhook secret",
    () => writeFixture("config/webhooks.txt", `RESEND_WEBHOOK_SECRET=${webhookToken}\n`),
    "config/webhooks.txt",
    "high-confidence access token",
    [webhookToken],
  )

  runFailureCase(
    "Unix local package dependency",
    () => writeFixture("package.json", JSON.stringify({ name: "fixture", dependencies: { foo: "file:/Users/example/foo" } })),
    "package.json",
    "package dependency points to local machine state",
  )
  runFailureCase(
    "Windows local package dependency",
    () => writeFixture("package.json", JSON.stringify({ name: "fixture", dependencies: { foo: "file:C:\\Users\\example\\foo" } })),
    "package.json",
    "package dependency points to local machine state",
  )

  runFailureCase(
    "large tracked file",
    () => writeFixture("large.bin", "x".repeat(MAX_TRACKED_FILE_BYTES + 1)),
    "large.bin",
    "maximum is",
  )

  clearFixture()
  assert(LARGE_FILE_ALLOWLIST.size === 0, "production large-file allowlist must remain empty")
  writeFixture("reviewed-source.bin", "x".repeat(MAX_TRACKED_FILE_BYTES + 1))
  trackFixture()
  const exactAllowlist = inspectTrackedFiles({ root: fixture, largeFileAllowlist: new Set(["reviewed-source.bin"]) })
  assert(!exactAllowlist.violations.some(({ file, reason }) => file === "reviewed-source.bin" && reason.includes("maximum is")), "exact large-file allowlist did not work")
  const globAllowlist = inspectTrackedFiles({ root: fixture, largeFileAllowlist: new Set(["*.bin"]) })
  assert(globAllowlist.violations.some(({ file, reason }) => file === "reviewed-source.bin" && reason.includes("maximum is")), "large-file allowlist accepted a glob")
  record("exact large-file allowlist")
  record("glob large-file allowlist rejected")

  runCleanCase("placeholder environment", () => {
    writeFixture(".env.example", [
      "OPENAI_API_KEY=<token>",
      "STRIPE_SECRET_KEY=sk_test_example-placeholder",
      "RESEND_WEBHOOK_SECRET=whsec_placeholder",
      "GITHUB_TOKEN=your-api-key",
      "WEBHOOK_SECRET=changeme",
    ].join("\n"))
  })
  runCleanCase("legitimate playwright source", () => writeFixture("tests/playwright/helpers.ts", "export const helper = true\n"))
  runCleanCase("legitimate generic source directories", () => {
    writeFixture("src/build/index.ts", "export const buildSource = true\n")
    writeFixture("src/output/serializer.ts", "export const outputSource = true\n")
    writeFixture("src/tmp/fixture.ts", "export const tmpSource = true\n")
    writeFixture("src/temp/fixture.ts", "export const tempSource = true\n")
    writeFixture("src/artifacts/fixture.ts", "export const artifactSource = true\n")
    writeFixture("scripts/safe-extensionless-script", "#!/usr/bin/env node\nconsole.log('safe')\n")
    writeFixture("README.md", "canonical source\n")
    writeFixture("docs/setup.md", "Use local placeholders only.\n")
    writeFixture("docs/schema.graphql", "type Query { health: Boolean! }\n")
    writeFixture("config/schema.prisma", "model Example { id String @id }\n")
    writeFixture("config/settings.xml", "<settings />\n")
    writeFixture("package.json", JSON.stringify({ name: "fixture", dependencies: { "@scope/core": "workspace:*" } }))
    writeFixture("assets/icon.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 0]), Buffer.from(sourceToken), Buffer.from([0, 1, 2, 3])]))
  })
  runCleanCase("clean repository", () => writeFixture("README.md", "canonical source\n"))

  console.log(JSON.stringify({
    status: "PASS",
    tests: results,
    failurePathsCovered: results.filter(({ name }) => !name.startsWith("legitimate") && name !== "placeholder environment" && name !== "clean repository").length,
    fixtureOutsideRepository: true,
  }))
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
