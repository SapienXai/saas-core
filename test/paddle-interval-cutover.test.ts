import { beforeEach, describe, expect, it, vi } from "vitest"
import { processDuePaddleIntervalChanges } from "../lib/billing/paddle-interval-cutover"

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  read: vi.fn(),
  approve: vi.fn(),
  stage: vi.fn(),
  resume: vi.fn(),
  reconcile: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: mocks.db }))
vi.mock("../lib/billing/providers/paddle", () => ({
  getPaddleSandboxConfig: vi.fn(),
  readPaddleIntervalApproval: mocks.approve,
  retrievePaddleSubscription: mocks.read,
  stagePaddleDeferredInterval: mocks.stage,
  resumePaddleDeferredInterval: mocks.resume,
}))
vi.mock("../lib/billing/paddle-webhook", () => ({ reconcilePaddleSubscription: mocks.reconcile }))
vi.mock("../lib/billing/subscription-projection", () => ({
  BillingProjectionError: Error,
  claimWorkspaceProjection: mocks.claim,
  releaseWorkspaceProjection: mocks.release,
}))
vi.mock("../lib/billing/price-mapping", () => ({
  getProviderPriceByProviderId: async () => ({
    plan_key: "pro", billing_interval: "month", provider_product_id: "product",
  }),
}))

const boundary = "2026-11-10T20:49:24.684Z"
const subscription = {
  provider_subscription_id: "subscription", provider_customer_id: "customer", scheduled_change_at: boundary,
}
const remote = {
  customerId: "customer",
  customData: { workspace_id: "workspace", billing_provider: "paddle", billing_environment: "sandbox" },
  items: [{ productId: "product" }],
  deferredIntervalChange: {
    scheduleId: "owner-request", effectiveAt: boundary, targetPriceId: "monthly", targetPlanKey: "pro", phase: "paused",
  },
}
type Attempt = { id: string; status: string; created_at: string }

function installDatabase() {
  let attempt: Attempt | null = null
  const workspaceQuery = {
    select: () => workspaceQuery,
    eq: () => workspaceQuery,
    lte: (_column: string, timestamp: string) => {
      const due = Date.parse(timestamp) >= Date.parse(boundary)
      return {
        maybeSingle: async () => ({ data: due ? subscription : null }),
        order: () => ({
          order: () => ({ limit: async () => ({ data: due ? [{ workspace_id: "workspace" }] : [] }) }),
        }),
      }
    },
  }
  const mutationQuery = {
    select: () => mutationQuery,
    eq: () => mutationQuery,
    maybeSingle: async () => ({ data: attempt }),
    insert: (values: { request_key: string }) => ({
      select: () => ({
        single: async () => {
          expect(values.request_key).toBe("paddle-interval-resume:owner-request")
          if (attempt) return { data: null, error: { code: "23505" } }
          attempt = { id: "attempt", status: "pending", created_at: boundary }
          return { data: attempt }
        },
      }),
    }),
    update: (values: { status: string }) => ({
      eq: () => ({
        eq: async () => {
          if (attempt?.status === "pending") attempt.status = values.status
          return {}
        },
      }),
    }),
  }
  mocks.db.mockReturnValue({ from: (table: string) => table === "workspace_subscriptions" ? workspaceQuery : mutationQuery })
  return () => attempt
}

describe("automatic Paddle interval cutover", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.read.mockResolvedValue(remote)
    mocks.approve.mockResolvedValue("succeeded")
    mocks.claim.mockResolvedValue({ leaseToken: "lease", revision: 1 })
    installDatabase()
  })

  it("never stages a price or attempts collection before the saved boundary", async () => {
    expect(await processDuePaddleIntervalChanges(new Date(Date.parse(boundary) - 1))).toEqual({ due: 0, resumed: 0, failed: 0 })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.stage).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it("waits for Paddle to confirm the pause even after the due date", async () => {
    mocks.read.mockResolvedValue({ ...remote, deferredIntervalChange: { ...remote.deferredIntervalChange, phase: "scheduled" } })
    await processDuePaddleIntervalChanges(new Date(boundary))
    expect(mocks.stage).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it("lets only one worker claim a charge even if their reads overlap", async () => {
    const collect = vi.fn()
    mocks.resume.mockImplementation(async (_binding, claim) => {
      if (!await claim()) return false
      collect()
      return true
    })
    const results = await Promise.all(Array.from({ length: 4 }, () => processDuePaddleIntervalChanges(new Date(boundary))))
    expect(results.reduce((total, result) => total + result.resumed, 0)).toBe(1)
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it("records an ambiguous charge attempt and reconciles without sending it again", async () => {
    const stored = installDatabase()
    mocks.resume.mockImplementation(async (_binding, claim) => {
      expect(await claim()).toBe(true)
      throw new Error("Timed out")
    })
    const report = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect((await processDuePaddleIntervalChanges(new Date(boundary))).failed).toBe(1)
      expect(stored()?.status).toBe("unknown")
      await processDuePaddleIntervalChanges(new Date(boundary))
      expect(mocks.resume).toHaveBeenCalledTimes(1)
      mocks.read.mockResolvedValue({ ...remote, deferredIntervalChange: { ...remote.deferredIntervalChange, phase: "resumed" } })
      await processDuePaddleIntervalChanges(new Date(boundary))
      expect(mocks.reconcile).toHaveBeenCalledWith("subscription", "workspace")
      expect(mocks.resume).toHaveBeenCalledTimes(1)
    } finally {
      report.mockRestore()
    }
  })
})
