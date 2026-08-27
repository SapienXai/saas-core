import { describe, expect, it } from "vitest"
import { deriveWorkspaceLifecycle, summarizeLifecycle } from "@/lib/platform-lifecycle"

describe("platform lifecycle", () => {
  it("derives the customer funnel from persisted milestones", () => {
    const lifecycle = deriveWorkspaceLifecycle({ id: "workspace-1", createdAt: "2026-01-01T00:00:00.000Z", onboardingCompletedAt: "2026-01-02T00:00:00.000Z", restaurants: [{ id: "restaurant-1", createdAt: "2026-01-02T00:00:00.000Z", status: "published" }], firstReservationAt: "2026-01-03T00:00:00.000Z", planKey: "pro", subscriptionStatus: "active" }, new Date("2026-01-10T00:00:00.000Z"))
    expect(Object.values(lifecycle.stages).every((stage) => stage.complete)).toBe(true)
    expect(lifecycle.health).not.toContain("onboarding_incomplete")
  })

  it("marks published customers without a booking and inactive customers", () => {
    const lifecycle = deriveWorkspaceLifecycle({ id: "workspace-2", createdAt: "2026-01-01T00:00:00.000Z", onboardingCompletedAt: null, restaurants: [{ id: "restaurant-2", createdAt: "2026-01-02T00:00:00.000Z", status: "published" }], firstReservationAt: null, planKey: "free", subscriptionStatus: "active" }, new Date("2026-08-12T00:00:00.000Z"))
    expect(lifecycle.health).toEqual(expect.arrayContaining(["onboarding_incomplete", "published_without_reservations", "inactive_30_days"]))
  })

  it("summarizes stage completion across workspaces", () => {
    const complete = deriveWorkspaceLifecycle({ id: "one", createdAt: "2026-01-01T00:00:00.000Z", onboardingCompletedAt: "2026-01-02T00:00:00.000Z", restaurants: [], firstReservationAt: null, planKey: "free", subscriptionStatus: "active" })
    expect(summarizeLifecycle([complete]).signup).toBe(1)
    expect(summarizeLifecycle([complete]).restaurant_created).toBe(0)
  })
})
