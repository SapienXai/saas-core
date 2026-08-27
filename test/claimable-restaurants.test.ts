import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import JSZip from "jszip"
import {
  hashClaimToken,
  hashReservationManageToken,
  isConsumerEmailDomain,
  isEligibleOfficialDomain,
  normalizeOfficialDomain,
} from "../lib/claimable-restaurants"
import { generateUnclaimedBusinessReservationEmail } from "../lib/reservation-email-templates"
import { buildRestaurantImportTemplate, parseRestaurantImportFile, validateRestaurantImportRows } from "../lib/platform-restaurant-import"

const validRow = (overrides: Record<string, unknown> = {}) => ({
  excelRowNumber: 2,
  values: {
    name: "Harbor House",
    business_contact_email: "owner@harborhouse.example",
    official_website_url: "https://harborhouse.example",
    slug: "",
    ...overrides,
  },
})

describe("claimable restaurant verification boundaries", () => {
  it("normalizes official domains and blocks consumer email domains", () => {
    expect(normalizeOfficialDomain("https://www.Mikorla.com/menu")).toBe("mikorla.com")
    expect(isConsumerEmailDomain("gmail.com")).toBe(true)
    expect(isConsumerEmailDomain("gmx.de")).toBe(true)
    expect(isConsumerEmailDomain("mikorla.com")).toBe(false)
    expect(isEligibleOfficialDomain("owner@gmail.com", "mikorla.com")).toBe(false)
    expect(isEligibleOfficialDomain("owner@mikorla.com", "https://www.mikorla.com")).toBe(true)
  })

  it("hashes bearer tokens instead of storing the raw value", () => {
    expect(hashClaimToken("claim-token-example")).not.toContain("claim-token-example")
    expect(hashReservationManageToken("manage-token-example")).not.toContain("manage-token-example")
    const migration = readFileSync("supabase/migrations/20260813130000_claimable_restaurants.sql", "utf8")
    expect(migration).toContain("token_hash")
    expect(migration).not.toContain("raw_token")
  })
})

describe("restaurant import validation", () => {
  it("parses the generated XLSX template server-side", async () => {
    const template = await buildRestaurantImportTemplate()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(template as any)
    workbook.getWorksheet("Restaurants")?.addRow(["Second House", "owner@second.example", "https://second.example"])
    const parsed = await parseRestaurantImportFile(new Uint8Array(await workbook.xlsx.writeBuffer()))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].payload.name).toBe("Second House")
    expect(parsed[0].status).toBe("ready")
  })

  it("accepts Google Sheets-style namespace-prefixed XLSX workbooks", async () => {
    const template = await buildRestaurantImportTemplate()
    const zip = await JSZip.loadAsync(template as any)
    const spreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    for (const name of Object.keys(zip.files)) {
      if (!name.startsWith("xl/") || !name.endsWith(".xml") || zip.files[name].dir) continue
      const file = zip.file(name)
      if (!file) continue
      const xml = await file.async("string")
      const prefixed = xml
        .replace(/<(\/?)([A-Za-z])/g, "<$1x:$2")
        .replace(/<x:([A-Za-z][\w.-]*)/, `<x:$1 xmlns:x="${spreadsheetNamespace}"`)
      zip.file(name, prefixed)
    }
    const parsed = await parseRestaurantImportFile(new Uint8Array(await zip.generateAsync({ type: "uint8array" })))
    expect(parsed).toHaveLength(0)
  })

  it("accepts valid rows, generates blank slugs, and allows duplicate names", () => {
    const rows = validateRestaurantImportRows([
      validRow(),
      validRow({ name: "Harbor House", business_contact_email: "second@another.example", official_website_url: "https://another.example" }),
    ])
    expect(rows.every((row) => row.status !== "error")).toBe(true)
    expect(rows[0].payload.slug).toBe("harbor-house")
    expect(rows[1].status).toBe("warning")
  })

  it("rejects missing/invalid email and website values", () => {
    const [row] = validateRestaurantImportRows([validRow({ business_contact_email: "", official_website_url: "not a url" })])
    expect(row.status).toBe("error")
    expect(row.messages.join(" ")).toContain("Business contact email is required")
    expect(row.messages.join(" ")).toContain("Official website URL is required")
  })

  it("allows blank contact fields in update mode and preserves them as untouched fields", () => {
    const [row] = validateRestaurantImportRows([{
      ...validRow({ business_contact_email: "", official_website_url: "", description: "Updated copy" }),
      providedFields: ["name", "description", "slug"],
    }], { mode: "update" })
    expect(row.status).toBe("ready")
    expect(row.providedFields).toContain("description")
    expect(row.providedFields).not.toContain("business_contact_email")
    expect(row.providedFields).not.toContain("official_website_url")
  })

  it("hard-fails duplicate business emails, safely adjusts slug collisions, and rejects formula-like cells", () => {
    const rows = validateRestaurantImportRows([
      validRow({ official_website_url: "https://one.example" }),
      validRow({ name: "Other House", business_contact_email: "owner@existing.example", official_website_url: "https://two.example", slug: "harbor-house" }),
      validRow({ name: "Formula House", business_contact_email: "=HYPERLINK(\"https://evil.example\")", official_website_url: "https://three.example" }),
    ], { existingSlugs: new Set(["harbor-house"]), existingBusinessEmails: new Set(["owner@existing.example"]) })
    expect(rows[0].status).toBe("warning")
    expect(rows[0].payload.slug).toBe("harbor-house-2")
    expect(rows[1].status).toBe("error")
    expect(rows[1].messages.join(" ")).toContain("already belongs")
    expect(rows[2].status).toBe("error")
  })
})

describe("unclaimed business reservation email", () => {
  it("never serializes guest phone or guest email", () => {
    const email = generateUnclaimedBusinessReservationEmail({
      customerName: "Ayse Yilmaz",
      restaurantName: "Harbor House",
      reservationDate: "18 May 2026",
      reservationTime: "20:30",
      partySize: 4,
      specialRequests: "Window seat",
      manageUrl: "http://localhost:3000/reservation/manage/manage-token",
      claimUrl: "http://localhost:3000/claim/restaurant-id?token=claim-token",
      publicUrl: "http://localhost:3000/r/harbor-house",
    })
    expect(email.subject).toContain("New reservation request via Reservevia")
    expect(email.html).toContain("Manage reservation")
    expect(email.html).toContain("Claim your business")
    expect(email.html).toContain("View your Reservevia page")
    expect(email.html).not.toContain("+90 532")
    expect(email.html).not.toContain("ayse@example.com")
    expect(email.text).not.toContain("+90 532")
    expect(email.text).not.toContain("ayse@example.com")
  })
})
