import { usesNeonBackend } from "@/lib/backend"
import { getPublishedNeonAsset } from "@/lib/neon/storage"

export async function GET(request: Request) {
  if (!usesNeonBackend()) return new Response(null, { status: 404 })
  const asset = await getPublishedNeonAsset(new URL(request.url).searchParams.get("path") ?? "")
  if (!asset) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.content_type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  })
}
