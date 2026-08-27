import { describe, expect, it } from "vitest"
import { filtersHaveValues, parsePlatformFilters } from "../lib/platform-filters"

describe("platform filter parsing", () => {
  it("normalizes supported URL filters and bounds pagination", () => {
    const filters = parsePlatformFilters(new URLSearchParams("q=%20felix%20&status=attention&plan=pro&page=99999&pageSize=500"))
    expect(filters).toMatchObject({ q: "felix", status: "attention", plan: "pro", page: 10000, pageSize: 100 })
    expect(filtersHaveValues(filters)).toBe(true)
  })

  it("falls back safely for unknown filters", () => {
    const filters = parsePlatformFilters({ status: "danger", plan: "gold", page: "0", pageSize: "-5" })
    expect(filters.status).toBe("all")
    expect(filters.plan).toBe("all")
    expect(filters.page).toBe(1)
    expect(filters.pageSize).toBe(30)
    expect(filtersHaveValues(filters)).toBe(false)
  })
})
