import { getPublicDoc } from "@/lib/public-docs"

export const dynamic = "force-static"

export async function GET(request: Request) {
  const slug = new URL(request.url).pathname.split("/").pop()?.replace(/\.md$/, "") || ""
  const doc = await getPublicDoc(slug)
  if (!doc) return new Response("Not found", { status: 404 })
  return new Response(doc.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600" } })
}
