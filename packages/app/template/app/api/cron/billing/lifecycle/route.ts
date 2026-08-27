import { expirePaymentGracePeriods } from "@/lib/billing/lifecycle"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: "Cron is not configured." }, { status: 503 })

  const authorization = request.headers.get("authorization")
  if (authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const result = await expirePaymentGracePeriods()
    return Response.json({ ok: true, ...result })
  } catch (error) {
    console.error("Billing lifecycle cron failed", { error: error instanceof Error ? error.message : String(error) })
    return Response.json({ error: "Billing lifecycle could not be completed." }, { status: 500 })
  }
}
