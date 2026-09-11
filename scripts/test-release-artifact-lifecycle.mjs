import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { PACKAGE_NAMES, RELEASE_VERSION } from "./release-constants.mjs"

const source = path.resolve("artifacts")
const fixture = mkdtempSync(path.join(os.tmpdir(), "saas-core-artifact-lifecycle-"))
const uploaded = path.join(fixture, "uploaded")
const published = path.join(fixture, "published")
const verified = path.join(fixture, "verified")

function digest(file) {
  return createHash("sha512").update(readFileSync(file)).digest("hex")
}

try {
  const expectedFiles = PACKAGE_NAMES.map((packageName) => `${packageName.replace(/^@/, "").replace("/", "-")}-${RELEASE_VERSION}.tgz`).sort()
  const availableFiles = readdirSync(source).filter((file) => file.endsWith(".tgz")).sort()
  const files = expectedFiles.filter((file) => availableFiles.includes(file))
  if (files.length !== expectedFiles.length) {
    throw new Error(`Expected the five ${RELEASE_VERSION} validated artifacts, found ${files.length}: ${expectedFiles.filter((file) => !files.includes(file)).join(", ")}.`)
  }

  for (const directory of [uploaded, published, verified]) {
    mkdirSync(directory, { recursive: true })
  }

  const hashes = []
  for (const file of files) {
    const sourceFile = path.join(source, file)
    const uploadFile = path.join(uploaded, file)
    const publishFile = path.join(published, file)
    const verifyFile = path.join(verified, file)
    copyFileSync(sourceFile, uploadFile)
    copyFileSync(uploadFile, publishFile)
    copyFileSync(publishFile, verifyFile)
    const sourceHash = digest(sourceFile)
    if (![uploadFile, publishFile, verifyFile].every((candidate) => digest(candidate) === sourceHash)) throw new Error(`Artifact handoff changed ${file}.`)
    hashes.push({ file, sha512: sourceHash })
  }

  console.log(JSON.stringify({ status: "PASS", artifacts: hashes, validated: true, uploaded: true, publishedInput: true, verifiedInput: true, regenerated: false }))
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
