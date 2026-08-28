import { describe, expect, it } from "vitest"
import { filtersHaveValues, parsePlatformFilters } from "../lib/platform-filters"

describe("platform filter parsing", () => {
  it("normalizes supported URL filters and bounds pagination", () => {
    const filters = parsePlatformFilters(new URLSearchParams("q=%20example%20&status=attention&plan=pro&page=99999&pageSize=500"))
    expect(filters).toMatchObject({ q: "example", status: "attention", plan: "pro", page: 10000, pageSize: 100 })
    expect(filtersHaveValues(filters)).toBe(true)
  })

  it("preserves arbitrary product plan filters while normalizing core filters", () => {
    const filters = parsePlatformFilters({ status: "danger", plan: "gold", page: "0", pageSize: "-5" })
    expect(filters.status).toBe("all")
    expect(filters.plan).toBe("gold")
    expect(filters.page).toBe(1)
    expect(filters.pageSize).toBe(30)
    expect(filtersHaveValues(filters)).toBe(true)
  })
})
