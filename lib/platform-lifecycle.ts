export type LifecycleStage = "signup" | "restaurant_created" | "published" | "first_booking" | "paid"

export type WorkspaceLifecycleSnapshot = {
  id: string
  createdAt: string
  onboardingCompletedAt: string | null
  restaurants: Array<{ id: string; createdAt: string; status: string }>
  firstReservationAt: string | null
  planKey: string
  subscriptionStatus: string | null
}

export type WorkspaceLifecycle = {
  stages: Record<LifecycleStage, { complete: boolean; at: string | null }>
  health: string[]
}

export function deriveWorkspaceLifecycle(snapshot: WorkspaceLifecycleSnapshot, now = new Date()): WorkspaceLifecycle {
  const firstRestaurant = [...snapshot.restaurants].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0] || null
  const publishedRestaurant = [...snapshot.restaurants].filter((restaurant) => restaurant.status === "published").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0] || null
  const stages = {
    signup: { complete: true, at: snapshot.createdAt },
    restaurant_created: { complete: Boolean(firstRestaurant), at: firstRestaurant?.createdAt || null },
    published: { complete: Boolean(publishedRestaurant), at: publishedRestaurant?.createdAt || null },
    first_booking: { complete: Boolean(snapshot.firstReservationAt), at: snapshot.firstReservationAt },
    paid: { complete: snapshot.planKey !== "free" && ["active", "trialing"].includes(snapshot.subscriptionStatus || ""), at: snapshot.subscriptionStatus && snapshot.planKey !== "free" ? snapshot.createdAt : null },
  } satisfies Record<LifecycleStage, { complete: boolean; at: string | null }>
  const health: string[] = []
  if (!snapshot.onboardingCompletedAt) health.push("onboarding_incomplete")
  if (stages.published.complete && !stages.first_booking.complete) health.push("published_without_reservations")
  if (!snapshot.firstReservationAt || new Date(snapshot.firstReservationAt).getTime() < now.getTime() - 30 * 86400000) health.push("inactive_30_days")
  if (snapshot.subscriptionStatus === "past_due") health.push("billing_issue")
  return { stages, health }
}

export function summarizeLifecycle(lifecycles: WorkspaceLifecycle[]) {
  const keys: LifecycleStage[] = ["signup", "restaurant_created", "published", "first_booking", "paid"]
  return Object.fromEntries(keys.map((key) => [key, lifecycles.filter((lifecycle) => lifecycle.stages[key].complete).length])) as Record<LifecycleStage, number>
}
