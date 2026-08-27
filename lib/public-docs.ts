import "server-only"

import { readFile } from "node:fs/promises"
import path from "node:path"

export const PUBLIC_DOCS = ["overview", "quickstart", "agents", "api", "mcp", "openai", "security"] as const
export type PublicDocSlug = (typeof PUBLIC_DOCS)[number]

function isPublicDocSlug(value: string): value is PublicDocSlug {
  return PUBLIC_DOCS.includes(value as PublicDocSlug)
}

export async function getPublicDoc(slug: string): Promise<{ slug: PublicDocSlug; markdown: string } | null> {
  if (!isPublicDocSlug(slug)) return null
  const filePath = path.join(process.cwd(), "docs", "public", `${slug}.md`)
  try {
    return { slug, markdown: await readFile(filePath, "utf8") }
  } catch {
    return null
  }
}

export function markdownBlocks(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const blocks: Array<{ type: "heading" | "paragraph" | "list" | "code"; level?: number; text?: string; items?: string[]; language?: string }> = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    const fence = /^```(.*)$/.exec(line)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith("```")) { code.push(lines[index]); index += 1 }
      blocks.push({ type: "code", text: code.join("\n"), language: fence[1].trim() || undefined })
      index += 1
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2] }); index += 1; continue }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) { items.push(lines[index].replace(/^[-*]\s+/, "")); index += 1 }
      blocks.push({ type: "list", items })
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index]) && !/^[-*]\s+/.test(lines[index]) && !lines[index].startsWith("```")) { paragraph.push(lines[index]); index += 1 }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") })
  }
  return blocks
}
