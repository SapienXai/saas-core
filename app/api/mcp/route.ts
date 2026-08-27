import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createReserveViaMcpServer } from "@/lib/ai/mcp-server"
import { recordAiEvent } from "@/lib/ai/observability"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return true
  const requestOrigin = new URL(request.url).origin
  const configured = (process.env.MCP_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)
  return origin === requestOrigin || configured.includes(origin)
}

async function handle(request: Request) {
  const startedAt = Date.now()
  if (!isAllowedOrigin(request)) return new Response("Forbidden origin", { status: 403 })
  if (request.method === "GET") return new Response("ReserveVia MCP uses Streamable HTTP POST requests.", { status: 405, headers: { allow: "POST, DELETE" } })
  const server = createReserveViaMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  const response = await transport.handleRequest(request)
  recordAiEvent({ event: "mcp_tool_invocation", provider: "mcp", latencyMs: Date.now() - startedAt })
  return response
}

export async function POST(request: Request) {
  return handle(request)
}

export async function DELETE(request: Request) {
  return handle(request)
}
