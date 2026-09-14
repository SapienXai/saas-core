import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

const directory = path.resolve(process.cwd(), process.argv[2] || "dist")

async function filesIn(currentDirectory) {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(currentDirectory, entry.name)
    if (entry.isDirectory()) files.push(...await filesIn(entryPath))
    else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) files.push(entryPath)
  }
  return files
}

function addExtension(source) {
  return source.replace(/\b(from\s*|import\s*(?:\(\s*)?)(["'])(\.\.?\/[^"']+)\2/g, (match, prefix, quote, specifier) => {
    const pathWithoutSuffix = specifier.split(/[?#]/, 1)[0]
    if (path.extname(pathWithoutSuffix)) return match
    return `${prefix}${quote}${specifier}.js${quote}`
  })
}

for (const file of await filesIn(directory)) {
  const source = await readFile(file, "utf8")
  const rewritten = addExtension(source)
  if (rewritten !== source) await writeFile(file, rewritten, "utf8")
}

await stat(directory)
