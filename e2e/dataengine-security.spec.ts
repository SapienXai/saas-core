import { test, expect } from "@playwright/test"

test("rejects unauthenticated DataEngine ingest", async ({ request }) => {
  const response = await request.post("/api/internal/v1/dataengine/reservevia/leads", {
    data: { contract_version: "reservevia.dataengine.leads.v1", batch_id: "unauthenticated", leads: [] },
  })
  expect(response.status()).toBe(401)
  const body = await response.json()
  expect(body.error?.code).toBe("UNAUTHORIZED_CLIENT")
  expect(JSON.stringify(body)).not.toContain("business_contact_email")
})
