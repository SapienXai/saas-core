import { beforeEach, describe, expect, it, vi } from "vitest"

const { createServiceRoleClient, deliverTrackedEmail } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  deliverTrackedEmail: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient }))
vi.mock("@/lib/email-delivery", () => ({ deliverTrackedEmail }))

import { GET, POST } from "@/app/api/internal/cron/email-outbox/route"

type Run = {
  id: string
  invocation_id: string
  trigger_type: "cron" | "manual"
  status: "running" | "completed" | "failed"
  processed_count: number
  sent_count: number
  retrying_count: number
  failed_count: number
}

function createOutboxService() {
  const runs = new Map<string, Run>()
  const insertedRuns: Array<Record<string, unknown>> = []
  const events = [{ id: "event-1" }]

  const service = {
    from(table: string) {
      if (table === "email_outbox_runs") {
        return {
          upsert(values: Record<string, unknown>) {
            insertedRuns.push(values)
            const invocationId = String(values.invocation_id)
            if (!runs.has(invocationId)) {
              runs.set(invocationId, {
                id: `run-${runs.size + 1}`,
                invocation_id: invocationId,
                trigger_type: values.trigger_type as Run["trigger_type"],
                status: "running",
                processed_count: 0,
                sent_count: 0,
                retrying_count: 0,
                failed_count: 0,
              })
            }
            return Promise.resolve({ error: null })
          },
          select() {
            return {
              eq(_column: string, value: string) {
                return {
                  maybeSingle: async () => ({ data: runs.get(value) || null, error: null }),
                }
              },
            }
          },
          update(values: Partial<Run>) {
            return {
              eq(_column: string, value: string) {
                const run = Array.from(runs.values()).find((candidate) => candidate.id === value)
                if (run) Object.assign(run, values)
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      }

      const query = {
        in() {
          return query
        },
        or() {
          return query
        },
        order() {
          return query
        },
        limit: async () => ({ data: events, error: null }),
      }
      return { select: () => query }
    },
  }

  return { service, runs, insertedRuns }
}

function request(method: "GET" | "POST", headers: Record<string, string> = {}) {
  return new Request("https://saas-core.test/api/internal/cron/email-outbox", { method, headers })
}

describe("email outbox cron route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.clearAllMocks()
  })

  it("returns 503 when CRON_SECRET is not configured and 401 when authorization is invalid", async () => {
    vi.stubEnv("CRON_SECRET", "")
    expect((await GET(request("GET"))).status).toBe(503)
    expect(createServiceRoleClient).not.toHaveBeenCalled()

    vi.stubEnv("CRON_SECRET", "test-secret")
    expect((await POST(request("POST", { authorization: "Bearer wrong" }))).status).toBe(401)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it("records manual requests without a cron schedule header for both GET and POST", async () => {
    const { service, insertedRuns } = createOutboxService()
    createServiceRoleClient.mockReturnValue(service)
    deliverTrackedEmail.mockResolvedValue({ success: true, data: { id: "message-1" } })

    expect((await GET(request("GET", { authorization: "Bearer test-secret", "x-request-id": "manual-get", "x-vercel-cron": "1" }))).status).toBe(200)
    expect((await POST(request("POST", { authorization: "Bearer test-secret", "x-request-id": "manual-post" }))).status).toBe(200)
    expect(insertedRuns.map((run) => run.trigger_type)).toEqual(["manual", "manual"])
  })

  it("records the current Vercel cron schedule header as cron telemetry only", async () => {
    const { service, insertedRuns } = createOutboxService()
    createServiceRoleClient.mockReturnValue(service)
    deliverTrackedEmail.mockResolvedValue({ success: true, data: { id: "message-1" } })

    const response = await GET(request("GET", {
      authorization: "Bearer test-secret",
      "x-vercel-cron-schedule": "0 * * * *",
      "x-vercel-cron": "1",
      "x-vercel-id": "cron-1",
    }))

    expect(response.status).toBe(200)
    expect(insertedRuns[0]).toMatchObject({ invocation_id: "cron-1", trigger_type: "cron" })
  })

  it("does not send again when the same invocation is replayed after completion", async () => {
    const { service } = createOutboxService()
    createServiceRoleClient.mockReturnValue(service)
    deliverTrackedEmail.mockResolvedValue({ success: true, data: { id: "message-1" } })

    const headers = { authorization: "Bearer test-secret", "x-request-id": "replayed-1" }
    const first = await GET(request("GET", headers))
    const second = await GET(request("GET", headers))

    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ sent: 1 })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ replayed: true, sent: 1 })
    expect(deliverTrackedEmail).toHaveBeenCalledTimes(1)
  })

  it("keeps concurrent delivery single-send through the delivery claim", async () => {
    const { service } = createOutboxService()
    createServiceRoleClient.mockReturnValue(service)
    const providerSend = vi.fn()
    const claimed = new Set<string>()
    deliverTrackedEmail.mockImplementation(async (eventId: string) => {
      if (claimed.has(eventId)) return { success: false, error: { code: "already_claimed" }, retryable: false }
      claimed.add(eventId)
      providerSend()
      return { success: true, data: { id: "message-1" } }
    })

    const headers = { authorization: "Bearer test-secret", "x-request-id": "concurrent-1" }
    const responses = await Promise.all([GET(request("GET", headers)), GET(request("GET", headers))])
    const bodies = await Promise.all(responses.map((response) => response.json()))

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(providerSend).toHaveBeenCalledTimes(1)
    expect(bodies.reduce((total, body) => total + body.sent, 0)).toBe(1)
  })
})
