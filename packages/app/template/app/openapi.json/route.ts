export const dynamic = "force-static"

export async function GET() {
  return Response.json({ openapi: "3.0.0", info: { title: "SaaS Core API", version: "2.8.0" }, paths: {} }, { headers: { "cache-control": "public, max-age=3600" } })
}
