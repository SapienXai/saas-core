import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

function readPackageManifest(tarball) {
  return JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }))
}

function packageIndex(artifactDirectory) {
  const packages = new Map()
  for (const filename of readdirSync(artifactDirectory)) {
    if (!filename.endsWith(".tgz")) continue
    const tarball = join(artifactDirectory, filename)
    const manifest = readPackageManifest(tarball)
    const versions = packages.get(manifest.name) ?? new Map()
    versions.set(manifest.version, {
      filename,
      manifest,
      integrity: `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`,
    })
    packages.set(manifest.name, versions)
  }
  return packages
}

function send(request, response, status, body, contentType) {
  response.writeHead(status, { "content-type": contentType })
  if (request.method === "HEAD") response.end()
  else response.end(body)
}

export async function startLocalPackageRegistry(artifactDirectory) {
  const directory = resolve(artifactDirectory)
  const packages = packageIndex(directory)
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(1))
    if (pathname.startsWith("tarballs/")) {
      const filename = pathname.slice("tarballs/".length)
      const available = [...packages.values()].flatMap((versions) => [...versions.values()]).find((entry) => entry.filename === filename)
      if (!available) return send(request, response, 404, "Not found\n", "text/plain")
      response.writeHead(200, { "content-type": "application/octet-stream" })
      if (request.method === "HEAD") return response.end()
      return response.end(readFileSync(join(directory, filename)))
    }

    const versions = packages.get(pathname)
    if (!versions) return send(request, response, 404, "Not found\n", "text/plain")
    const host = `http://127.0.0.1:${server.address().port}`
    const metadata = {
      name: pathname,
      "dist-tags": { latest: [...versions.keys()].sort().at(-1) },
      versions: Object.fromEntries([...versions.entries()].map(([version, entry]) => [version, {
        ...entry.manifest,
        dist: { tarball: `${host}/tarballs/${encodeURIComponent(entry.filename)}`, integrity: entry.integrity },
      }])),
    }
    return send(request, response, 200, JSON.stringify(metadata), "application/json")
  })

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const artifactDirectory = process.argv[2]
  const outputPath = process.argv[3]
  if (!artifactDirectory || !outputPath) throw new Error("Usage: node scripts/local-package-registry.mjs <artifact-directory> <url-output-file>")
  const registry = await startLocalPackageRegistry(artifactDirectory)
  writeFileSync(outputPath, `${registry.url}\n`, "utf8")
  const shutdown = async () => { await registry.close(); process.exit(0) }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  await new Promise(() => {})
}
