import { usesNeonBackend } from "@/lib/backend"
import { getNeonAuth } from "@/lib/neon/auth"

const publicEndpoints = new Set([
  "get-session", "sign-in/social", "sign-out", "callback/google",
  "verify-email", "request-password-reset", "reset-password",
])

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const endpoint = path.join("/")
  const resetCallback = request.method === "GET" && path.length === 2 && path[0] === "reset-password"
  if (!usesNeonBackend() || (!publicEndpoints.has(endpoint) && !resetCallback)) {
    return new Response(null, { status: 404 })
  }
  const response = await getNeonAuth().handler(request)
  response.headers.set("Cache-Control", "no-store")
  return response
}

export const GET = handle
export const POST = handle
