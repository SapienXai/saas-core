import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getPublicDoc, markdownBlocks, PUBLIC_DOCS } from "@/lib/public-docs"
import { PublicDocsNavigation } from "@/components/public-docs-navigation"

const navigation = [
  ["overview", "Overview"],
  ["quickstart", "Quickstart"],
  ["agents", "AI agents"],
  ["api", "REST API"],
  ["mcp", "MCP"],
  ["openai", "OpenAI"],
  ["security", "Security"],
] as const

export const dynamic = "force-static"

export async function generateStaticParams() {
  return PUBLIC_DOCS.filter((slug) => slug !== "overview").map((slug) => ({ slug: [slug] }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug } = await params
  const current = slug?.[0] || "overview"
  const doc = await getPublicDoc(current)
  return { title: doc ? `${current === "overview" ? "Docs" : `${current[0].toUpperCase()}${current.slice(1)} · Docs`} · ReserveVia` : "Docs · ReserveVia", description: "AI-native restaurant reservation infrastructure documentation." }
}

function renderInline(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) => part.startsWith("`") && part.endsWith("`") ? <code key={index} className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.9em] dark:bg-white/10">{part.slice(1, -1)}</code> : part)
}

export default async function PublicDocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const current = slug?.[0] || "overview"
  const doc = await getPublicDoc(current)
  if (!doc) notFound()
  const blocks = markdownBlocks(doc.markdown)
  return (
    <main className="min-h-screen bg-[#fbfbfd] text-slate-950 dark:bg-[#090a0f] dark:text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[220px_minmax(0,760px)] lg:gap-20 lg:py-14">
        <PublicDocsNavigation current={current} navigation={navigation} />
        <article className="min-w-0">
          {blocks.map((block, index) => {
            if (block.type === "heading") {
              const Tag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3"
              return <Tag key={index} className={block.level === 1 ? "mb-5 text-4xl font-semibold tracking-tight" : block.level === 2 ? "mb-3 mt-12 text-2xl font-semibold tracking-tight" : "mb-2 mt-8 text-lg font-semibold"}>{renderInline(block.text || "")}</Tag>
            }
            if (block.type === "code") return <pre key={index} className="my-6 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 p-5 text-sm leading-6 text-slate-100 shadow-sm dark:border-white/10"><code>{block.text}</code></pre>
            if (block.type === "list") return <ul key={index} className="my-5 grid gap-2 pl-5 text-[15px] leading-7 text-slate-600 marker:text-violet-500 dark:text-slate-300">{block.items?.map((item) => <li key={item}>{renderInline(item)}</li>)}</ul>
            return <p key={index} className="my-5 max-w-3xl text-[15px] leading-7 text-slate-600 dark:text-slate-300">{renderInline(block.text || "")}</p>
          })}
          <div className="mt-16 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-white/10">Machine-readable versions: <Link className="text-violet-600 hover:underline" href={`/docs/${current}.md`}>Markdown</Link> · <Link className="text-violet-600 hover:underline" href="/openapi.json">OpenAPI</Link></div>
        </article>
      </div>
    </main>
  )
}
