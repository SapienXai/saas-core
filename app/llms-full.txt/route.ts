import { getPublicDoc, PUBLIC_DOCS } from "@/lib/public-docs"

export const dynamic = "force-static"

export async function GET() {
  const docs = await Promise.all(PUBLIC_DOCS.map((slug) => getPublicDoc(slug)))
  return new Response(docs.filter(Boolean).map((doc) => doc!.markdown).join("\n\n---\n\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } })
}
