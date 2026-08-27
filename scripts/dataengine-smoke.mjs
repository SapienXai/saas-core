import { readFileSync } from "node:fs"

const CONTRACT_VERSION = "reservevia.dataengine.leads.v1"

function usage() {
  console.log(`Controlled private-review smoke test. This command never approves, publishes, creates a reservation, or sends email.

Usage:
  DATAENGINE_SMOKE_CREDENTIAL=rv_live_... pnpm dataengine:smoke -- \\
    --base-url https://app.example.com \\
    --payload /secure/path/private-smoke-payload.json \\
    --confirm DATAENGINE_PRIVATE_REVIEW_ONLY

The credential is read from the environment and is never printed. The payload
must use a smoke-* batch_id and smoke: candidate_id values. Only 1-3 leads are
allowed. A host allow-list can be enforced with DATAENGINE_SMOKE_ALLOW_HOST.`)
}

function arg(args, name, required = true) {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  if (required && (!value || value.startsWith("--"))) throw new Error(`${name} is required.`)
  return value
}

function parsePayload(path) {
  let payload
  try {
    payload = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new Error("Smoke payload could not be read as JSON.")
  }
  if (payload?.contract_version !== CONTRACT_VERSION) throw new Error(`Payload contract_version must be ${CONTRACT_VERSION}.`)
  if (!/^smoke[-:]/.test(String(payload.batch_id || ""))) throw new Error("Smoke payload batch_id must start with smoke- or smoke:.")
  if (!Array.isArray(payload.leads) || payload.leads.length < 1 || payload.leads.length > 3) throw new Error("Smoke payload must contain between 1 and 3 leads.")
  const ids = new Set()
  for (const lead of payload.leads) {
    if (!/^smoke:/.test(String(lead?.candidate_id || ""))) throw new Error("Every smoke candidate_id must start with smoke:.")
    if (ids.has(lead.candidate_id)) throw new Error("Smoke payload contains duplicate candidate_id values.")
    ids.add(lead.candidate_id)
  }
  return payload
}

function resolveBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error("--base-url must be an absolute http(s) URL.") }
  if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error("--base-url must use http or https.")
  const allowHost = process.env.DATAENGINE_SMOKE_ALLOW_HOST?.trim().toLowerCase()
  if (allowHost && url.hostname.toLowerCase() !== allowHost) throw new Error("Smoke base URL is outside DATAENGINE_SMOKE_ALLOW_HOST.")
  if (!allowHost && /^(localhost|127\.0\.0\.1|::1)$/i.test(url.hostname)) throw new Error("A local smoke requires an explicit DATAENGINE_SMOKE_ALLOW_HOST value.")
  return url.toString().replace(/\/$/, "")
}

function conflictPayload(payload) {
  const next = structuredClone(payload)
  if (next.source_export_id) next.source_export_id = `${next.source_export_id}-conflict`
  else if (next.source_run_id) next.source_run_id = `${next.source_run_id}-conflict`
  else next.source_export_id = `${next.batch_id}-conflict`
  return next
}

function safeResponse(response, body) {
  return {
    status: response.status,
    contract_version: body?.contract_version || null,
    replayed: body?.replayed === true,
    batch_id: body?.batch?.external_batch_id || null,
    batch_status: body?.batch?.status || null,
    lead_statuses: Array.isArray(body?.leads) ? body.leads.map((lead) => ({ readiness_status: lead.readiness_status, review_status: lead.review_status, publish_status: lead.publish_status })) : [],
    error_code: body?.error?.code || null,
  }
}

async function send(baseUrl, credential, payload) {
  const response = await fetch(`${baseUrl}/api/internal/v1/dataengine/reservevia/leads`, {
    method: "POST",
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  let body = null
  try { body = await response.json() } catch { /* Keep only status when the server returned non-JSON. */ }
  return { response, body }
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === "--") args.shift()
  if (args[0] === "help" || args.includes("--help")) return usage()
  if (arg(args, "--confirm") !== "DATAENGINE_PRIVATE_REVIEW_ONLY") throw new Error("Refusing smoke: --confirm DATAENGINE_PRIVATE_REVIEW_ONLY is required.")
  const credential = process.env.DATAENGINE_SMOKE_CREDENTIAL
  if (!credential || !/^rv_live_[A-Za-z0-9_-]{20,}$/.test(credential)) throw new Error("DATAENGINE_SMOKE_CREDENTIAL must be a valid server-side live credential.")
  const baseUrl = resolveBaseUrl(arg(args, "--base-url"))
  const payload = parsePayload(arg(args, "--payload"))
  const first = await send(baseUrl, credential, payload)
  if (first.response.status !== 202) throw new Error(`Initial private ingest expected 202; received ${first.response.status}. ${JSON.stringify(safeResponse(first.response, first.body))}`)
  const replay = await send(baseUrl, credential, payload)
  if (replay.response.status !== 200 || replay.body?.replayed !== true) throw new Error(`Identical replay expected 200 with replayed=true; received ${replay.response.status}. ${JSON.stringify(safeResponse(replay.response, replay.body))}`)
  const conflict = await send(baseUrl, credential, conflictPayload(payload))
  if (conflict.response.status !== 409) throw new Error(`Body conflict expected 409; received ${conflict.response.status}. ${JSON.stringify(safeResponse(conflict.response, conflict.body))}`)
  console.log(JSON.stringify({ base_url: baseUrl, initial: safeResponse(first.response, first.body), replay: safeResponse(replay.response, replay.body), conflict: safeResponse(conflict.response, conflict.body), automatic_publication: "not_requested" }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Smoke test failed.")
  process.exitCode = 1
})
