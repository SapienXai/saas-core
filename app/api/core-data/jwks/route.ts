import { getDataApiJwks, getDataTransport } from "@sapienx/saas-core/postgres"
import { usesNeonBackend } from "@/lib/backend"

export function GET() {
  if (!usesNeonBackend() || getDataTransport() !== "postgrest") return new Response(null, { status: 404 })
  return Response.json(getDataApiJwks(), { headers: { "Cache-Control": "public, max-age=60" } })
}
