import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))
const port = Number(process.env.CORE_LAB_PORT ?? 4173)
const scenarios = [
  { id: "tenant-isolation", title: "Tenant isolation", description: "User A cannot read or write Workspace B.", status: "BLOCKED AS EXPECTED", detail: "Cross-tenant selector rejected by workspace membership predicate." },
  { id: "seat-limit", title: "Seat limit", description: "Pending invitations reserve a seat before acceptance.", status: "BLOCKED AS EXPECTED", detail: "Free limit 1: active 1 + pending 1 exceeds the limit." },
  { id: "invitation-replay", title: "Invitation replay", description: "Accepted invitation tokens cannot be reused.", status: "PASS", detail: "Token hash is one-use and plaintext is never persisted." },
  { id: "billing-order", title: "Billing event order", description: "Older provider events cannot overwrite local state.", status: "PASS", detail: "lastProviderEventAt ordering guard kept the newer state." },
  { id: "grace-expiry", title: "Payment grace", description: "Expired past_due access falls back to Free without deleting data.", status: "PASS", detail: "Provider identifiers remain intact while effective plan becomes Free." },
  { id: "support-readonly", title: "Support read-only", description: "Support may inspect a workspace but cannot mutate it.", status: "BLOCKED AS EXPECTED", detail: "Platform permission boundary rejects support mutation." },
  { id: "domain-normalization", title: "Domain normalization", description: "Platform hosts and IP addresses are rejected.", status: "PASS", detail: "Hostname normalization strips scheme/trailing dot and fails closed." },
  { id: "usage-race", title: "Usage quota", description: "A bounded metric cannot exceed its plan limit.", status: "PASS", detail: "The usage boundary evaluates the limit before increment." },
]

const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" }
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/api/scenarios") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
      response.end(JSON.stringify({ version: "1.0.0", generatedAt: "2026-08-24T00:00:00.000Z", scenarios }))
      return
    }
    const relative = request.url === "/" ? "/index.html" : request.url?.split("?")[0] ?? "/index.html"
    const file = join(root, "public", relative)
    const body = await readFile(file)
    response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "application/octet-stream" })
    response.end(body)
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
    response.end("Not found")
  }
})

server.listen(port, "127.0.0.1", () => console.log(`Core Lab running at http://127.0.0.1:${port}`))
