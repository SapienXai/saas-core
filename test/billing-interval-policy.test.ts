import { describe, expect, it } from "vitest"
import { resolveBillingIntervalChangePolicy } from "../lib/billing/interval-policy"

describe("billing interval change policy", () => {
  it("moves monthly subscriptions to annual billing immediately with provider proration", () => {
    expect(resolveBillingIntervalChangePolicy("month", "year")).toEqual({
      kind: "interval_change",
      timing: "immediate",
      providerProrationBillingMode: "prorated_immediately",
    })
  })

  it("defers annual to monthly changes until the current annual period ends", () => {
    expect(resolveBillingIntervalChangePolicy("year", "month")).toEqual({
      kind: "interval_change",
      timing: "period_end",
      providerProrationBillingMode: "do_not_bill",
    })
  })

  it("rejects same-interval and incomplete transitions before provider work", () => {
    expect(resolveBillingIntervalChangePolicy("month", "month")).toEqual({ kind: "none", timing: "none", providerProrationBillingMode: null })
    expect(resolveBillingIntervalChangePolicy("year", "year")).toEqual({ kind: "none", timing: "none", providerProrationBillingMode: null })
    expect(resolveBillingIntervalChangePolicy(null, "year")).toEqual({ kind: "none", timing: "none", providerProrationBillingMode: null })
    expect(resolveBillingIntervalChangePolicy("quarter" as never, "month")).toEqual({ kind: "none", timing: "none", providerProrationBillingMode: null })
  })
})
