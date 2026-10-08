import { describe, expect, it } from "vitest"
import { canResumePendingCheckout } from "../lib/billing/checkout-resumption"

const context = {
  workspaceId: "workspace-1",
  provider: "stripe",
  environment: "sandbox",
  planKey: "pro-v3",
  priceId: "price-pro-month",
}

const checkout = {
  workspace_id: "workspace-1",
  provider: "stripe",
  environment: "sandbox",
  target_plan_key: "pro-v3",
  provider_price_id: "price-pro-month",
  provider_transaction_id: "cs_test_open",
  idempotency_key: "mutation-1",
  status: "created",
}

const mutation = { id: "mutation-1", operation: "checkout", status: "pending" }

describe("pending hosted checkout resumption", () => {
  it("accepts a created session tied to the same pending Workspace checkout", () => {
    expect(canResumePendingCheckout({ checkout, mutation, ...context })).toBe(true)
    expect(canResumePendingCheckout({ checkout, mutation: { ...mutation, status: "unknown" }, ...context })).toBe(true)
  })

  it("rejects sessions or mutations that do not match the current request", () => {
    expect(canResumePendingCheckout({ checkout: { ...checkout, workspace_id: "another-workspace" }, mutation, ...context })).toBe(false)
    expect(canResumePendingCheckout({ checkout: { ...checkout, target_plan_key: "business-v3" }, mutation, ...context })).toBe(false)
    expect(canResumePendingCheckout({ checkout: { ...checkout, provider_price_id: "another-price" }, mutation, ...context })).toBe(false)
    expect(canResumePendingCheckout({ checkout: { ...checkout, status: "expired" }, mutation, ...context })).toBe(false)
    expect(canResumePendingCheckout({ checkout: { ...checkout, provider_transaction_id: null }, mutation, ...context })).toBe(false)
    expect(canResumePendingCheckout({ checkout, mutation: { ...mutation, status: "failed" }, ...context })).toBe(false)
  })
})
