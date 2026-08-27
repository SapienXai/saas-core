import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase"
import { deliverTrackedEmail } from "@/lib/email-delivery"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function unauthorizedOrUnconfigured(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Cron is not configured." }, { status: 503 })
  const expected = process.env.CRON_SECRET
  const authorization = request.headers.get("authorization")
  if (authorization !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  return null
}

async function runEmailOutbox(request: Request) {
  const authError = unauthorizedOrUnconfigured(request)
  if (authError) return authError

  const service = createServiceRoleClient()
  const invocationId = request.headers.get("x-vercel-id") || request.headers.get("x-request-id") || randomUUID()
  const trigger = request.headers.get("x-vercel-cron-schedule")?.trim() ? "cron" : "manual"
  const { error: runInsertError } = await service.from("email_outbox_runs").upsert({ invocation_id: invocationId, trigger_type: trigger, status: "running" }, { onConflict: "invocation_id", ignoreDuplicates: true })
  if (runInsertError) {
    console.error("Email outbox run could not be recorded.", { code: "outbox_run_persistence_failed" })
    return NextResponse.json({ error: "Outbox observability is not configured." }, { status: 503 })
  }
  const { data: run, error: runSelectError } = await service.from("email_outbox_runs").select("id, status, processed_count, sent_count, retrying_count, failed_count").eq("invocation_id", invocationId).maybeSingle()
  if (runSelectError) return NextResponse.json({ error: "Outbox run could not be read." }, { status: 503 })
  if (!run) return NextResponse.json({ error: "Outbox run could not be recorded." }, { status: 503 })
  if (run.status === "completed") {
    return NextResponse.json({ run_id: run.id, processed: run.processed_count, sent: run.sent_count, retrying: run.retrying_count, failed: run.failed_count, replayed: true }, { headers: { "cache-control": "no-store" } })
  }

  const { data: events, error } = await service.from("email_delivery_events").select("id").in("status", ["pending", "retrying"]).or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`).order("created_at", { ascending: true }).limit(25)
  if (error) {
    await service.from("email_outbox_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_code: "outbox_query_failed" }).eq("id", run.id)
    return NextResponse.json({ error: "Outbox query failed.", run_id: run.id }, { status: 500 })
  }
  const results: Array<{ id: string; status: string }> = []
  for (const event of events || []) {
    try {
      const result = await deliverTrackedEmail(event.id)
      results.push({ id: event.id, status: result.success ? "sent" : ("retryable" in result && result.retryable) ? "retrying" : "failed" })
    } catch {
      results.push({ id: event.id, status: "error" })
    }
  }
  const counts = {
    processed: results.length,
    sent: results.filter((result) => result.status === "sent").length,
    retrying: results.filter((result) => result.status === "retrying").length,
    failed: results.filter((result) => ["failed", "error"].includes(result.status)).length,
  }
  const { error: runUpdateError } = await service.from("email_outbox_runs").update({ status: "completed", finished_at: new Date().toISOString(), processed_count: counts.processed, sent_count: counts.sent, retrying_count: counts.retrying, failed_count: counts.failed, error_code: counts.failed ? "delivery_failures_present" : null }).eq("id", run.id)
  if (runUpdateError) {
    console.error("Email outbox run could not be finalized.", { code: "outbox_run_finalize_failed" })
    return NextResponse.json({ error: "Outbox run could not be finalized.", run_id: run.id }, { status: 500 })
  }
  return NextResponse.json({ run_id: run.id, ...counts, results }, { headers: { "cache-control": "no-store" } })
}

export async function GET(request: Request) {
  return runEmailOutbox(request)
}

export async function POST(request: Request) {
  return runEmailOutbox(request)
}
