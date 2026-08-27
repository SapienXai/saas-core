import "server-only"

import ExcelJS from "exceljs"
import JSZip from "jszip"
import { appendRestaurantSlugSuffix, isRestaurantSlug, slugifyRestaurantName, validateRestaurantSlug } from "@/lib/restaurant-profile"
import { normalizeBusinessEmail, normalizeOfficialDomain, normalizeOfficialWebsiteUrl } from "@/lib/claimable-restaurants"

export const RESTAURANT_IMPORT_MAX_BYTES = 10 * 1024 * 1024
export const RESTAURANT_IMPORT_MAX_ROWS = 500

export type RestaurantImportPayload = {
  name: string
  business_contact_email: string
  official_website_url: string
  slug: string
  description?: string | null
  cuisine?: string | null
  location?: string | null
  phone?: string | null
  hours?: string | null
  atmosphere?: string | null
  timezone?: string | null
  language?: string | null
  reservation_enabled?: boolean
  opening_time?: string | null
  closing_time?: string | null
  time_slot_duration?: number
  advance_booking_days?: number
  min_advance_hours?: number
  min_party_size?: number
  max_party_size?: number
  meal_only_reservations?: boolean
  official_domain?: string
}

export type RestaurantImportColumn = {
  key: keyof RestaurantImportPayload
  header: string
  required: boolean
  description: string
  format: string
  example: string
  defaultValue?: string
}

export const restaurantImportColumns: RestaurantImportColumn[] = [
  { key: "name", header: "Restaurant name", required: true, description: "Public restaurant name.", format: "Text, 1–120 characters", example: "Harbor House" },
  { key: "business_contact_email", header: "Business contact email", required: true, description: "Private address that receives reservation requests.", format: "Valid email address", example: "owner@harborhouse.example" },
  { key: "official_website_url", header: "Official website URL", required: true, description: "Official website used for domain verification signals.", format: "http(s) URL or hostname", example: "https://harborhouse.example" },
  { key: "official_domain", header: "Official domain", required: false, description: "Optional explicit domain; otherwise derived from the website URL.", format: "Hostname only", example: "harborhouse.example", defaultValue: "Derived from official website URL" },
  { key: "slug", header: "Public slug", required: false, description: "Stable public URL segment. Blank values are generated and collision-safe.", format: "Lowercase URL slug", example: "harbor-house", defaultValue: "Generated from restaurant name" },
  { key: "description", header: "Description", required: false, description: "Short public description.", format: "Text", example: "Seasonal cooking by the water." },
  { key: "cuisine", header: "Cuisine", required: false, description: "Public cuisine label.", format: "Text", example: "Mediterranean" },
  { key: "location", header: "Location", required: false, description: "Existing public location field.", format: "Text", example: "Marina district" },
  { key: "phone", header: "Business phone", required: false, description: "Public business phone shown on the restaurant page.", format: "Text", example: "+90 252 000 00 00" },
  { key: "hours", header: "Hours", required: false, description: "Public hours copy.", format: "Text", example: "Daily · 17:00–23:00" },
  { key: "atmosphere", header: "Atmosphere", required: false, description: "Public atmosphere label.", format: "Text", example: "Relaxed" },
  { key: "timezone", header: "Timezone", required: false, description: "IANA timezone used by booking validation.", format: "IANA timezone", example: "Europe/Istanbul", defaultValue: "UTC" },
  { key: "language", header: "Language", required: false, description: "Restaurant language code.", format: "en, tr, or es", example: "en", defaultValue: "en" },
  { key: "reservation_enabled", header: "Reservations enabled", required: false, description: "Whether the public page accepts reservation requests.", format: "true/false or yes/no", example: "true", defaultValue: "true" },
  { key: "opening_time", header: "Opening time", required: false, description: "Booking opening time.", format: "HH:mm", example: "17:00", defaultValue: "09:00" },
  { key: "closing_time", header: "Closing time", required: false, description: "Booking closing time.", format: "HH:mm", example: "23:00", defaultValue: "22:00" },
  { key: "time_slot_duration", header: "Time slot duration", required: false, description: "Booking slot length in minutes.", format: "Integer 1–240", example: "30", defaultValue: "30" },
  { key: "advance_booking_days", header: "Advance booking days", required: false, description: "How far ahead guests may book.", format: "Integer 0–365", example: "30", defaultValue: "30" },
  { key: "min_advance_hours", header: "Minimum advance hours", required: false, description: "Minimum notice before a reservation.", format: "Integer 0–168", example: "2", defaultValue: "2" },
  { key: "min_party_size", header: "Minimum party size", required: false, description: "Smallest accepted party.", format: "Positive integer", example: "1", defaultValue: "1" },
  { key: "max_party_size", header: "Maximum party size", required: false, description: "Largest accepted party.", format: "Positive integer", example: "12", defaultValue: "12" },
  { key: "meal_only_reservations", header: "Meal only reservations", required: false, description: "Reject drinks-only reservation type when true.", format: "true/false or yes/no", example: "false", defaultValue: "false" },
]

// Keep the downloaded workbook focused on the information an operator usually
// has at acquisition time. The parser still accepts every column above so
// richer workbooks, including the previous 22-column format, remain compatible.
export const restaurantTemplateColumns = restaurantImportColumns.filter((column) => [
  "name",
  "business_contact_email",
  "official_website_url",
  "official_domain",
  "slug",
  "description",
  "cuisine",
  "location",
  "phone",
  "hours",
  "timezone",
  "reservation_enabled",
].includes(column.key))

export type ParsedRestaurantImportRow = {
  excelRowNumber: number
  payload: RestaurantImportPayload
  providedFields: Array<keyof RestaurantImportPayload>
  status: "ready" | "warning" | "error"
  messages: string[]
}

export type RestaurantImportValidationRow = {
  excelRowNumber: number
  values: Record<string, unknown>
  providedFields?: Array<keyof RestaurantImportPayload>
}

export type ImportValidationContext = {
  existingSlugs?: Set<string>
  existingBusinessEmails?: Set<string>
  mode?: "create" | "update"
}

function textValue(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "object" && value !== null && "formula" in value) return ""
  return String(value).trim()
}

function headerKey(value: unknown) {
  return textValue(value).replace(/\s+/g, " ").toLowerCase()
}

const XML_ELEMENT_NAMESPACE_PATTERN = /(<\/?)([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)/g

async function normalizePrefixedExcelXml(buffer: Uint8Array) {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return buffer
  }

  const workbookXml = zip.file("xl/workbook.xml")
  if (!workbookXml) return buffer
  const workbookText = await workbookXml.async("string")
  if (!XML_ELEMENT_NAMESPACE_PATTERN.test(workbookText)) return buffer
  XML_ELEMENT_NAMESPACE_PATTERN.lastIndex = 0

  let changed = false
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith("xl/") || !name.endsWith(".xml") || zip.files[name].dir) continue
    const entry = zip.file(name)
    if (!entry) continue
    const xml = await entry.async("string")
    XML_ELEMENT_NAMESPACE_PATTERN.lastIndex = 0
    const normalized = xml.replace(XML_ELEMENT_NAMESPACE_PATTERN, "$1$3")
    if (normalized !== xml) {
      zip.file(name, normalized)
      changed = true
    }
  }

  return changed ? zip.generateAsync({ type: "uint8array" }) : buffer
}

function booleanValue(value: unknown, fallback: boolean) {
  const normalized = textValue(value).toLowerCase()
  if (!normalized) return fallback
  if (["true", "yes", "y", "1", "on"].includes(normalized)) return true
  if (["false", "no", "n", "0", "off"].includes(normalized)) return false
  return null
}

function integerValue(value: unknown, fallback: number) {
  const normalized = textValue(value)
  if (!normalized) return fallback
  if (!/^\d+$/.test(normalized)) return null
  return Number(normalized)
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320
}

function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function validateRestaurantImportRows(rows: RestaurantImportValidationRow[], context: ImportValidationContext = {}) {
  const usedSlugs = new Set(context.existingSlugs || [])
  const usedEmails = new Set(context.existingBusinessEmails || [])
  const updateMode = context.mode === "update"
  const result: ParsedRestaurantImportRow[] = []

  for (const row of rows) {
    const values = row.values
    const messages: string[] = []
    if (values.__formula_cell__ === true) messages.push("Formula cells are not accepted; enter literal values.")
    const name = textValue(values.name)
    const businessEmail = normalizeBusinessEmail(textValue(values.business_contact_email)) || ""
    const website = normalizeOfficialWebsiteUrl(textValue(values.official_website_url))
    const explicitDomainValue = textValue(values.official_domain)
    const explicitDomain = normalizeOfficialDomain(explicitDomainValue)
    if (!name && !updateMode) messages.push("Restaurant name is required.")
    if (name.length > 120) messages.push("Restaurant name must be 120 characters or fewer.")
    if (!businessEmail && !updateMode) messages.push("Business contact email is required.")
    else if (businessEmail && !validEmail(businessEmail)) messages.push("Business contact email is invalid.")
    if (!website && !updateMode) messages.push("Official website URL is required and must be a valid http(s) URL.")
    if (explicitDomainValue && !explicitDomain) messages.push("Official domain must be a valid hostname.")

    const baseSlug = textValue(values.slug).toLowerCase() || slugifyRestaurantName(name || "restaurant")
    const slugError = validateRestaurantSlug(baseSlug)
    if (slugError && textValue(values.slug)) messages.push(slugError)
    let slug = isRestaurantSlug(baseSlug) ? baseSlug : slugifyRestaurantName(name || "restaurant")
    if (!isRestaurantSlug(slug)) slug = "restaurant"
    if (usedSlugs.has(slug)) {
      let suffix = 2
      while (usedSlugs.has(appendRestaurantSlugSuffix(slug, suffix))) suffix += 1
      slug = appendRestaurantSlugSuffix(slug, suffix)
      messages.push("Public slug collided and was adjusted safely.")
    }
    usedSlugs.add(slug)

    if (businessEmail && usedEmails.has(businessEmail)) messages.push("Business contact email already belongs to another restaurant.")
    if (businessEmail) usedEmails.add(businessEmail)

    const reservationEnabled = booleanValue(values.reservation_enabled, true)
    const mealOnly = booleanValue(values.meal_only_reservations, false)
    if (reservationEnabled === null) messages.push("Reservations enabled must be true or false.")
    if (mealOnly === null) messages.push("Meal only reservations must be true or false.")
    const openingTime = textValue(values.opening_time) || "09:00"
    const closingTime = textValue(values.closing_time) || "22:00"
    if (!validTime(openingTime) || !validTime(closingTime) || openingTime >= closingTime) messages.push("Opening and closing time must be valid HH:mm values with opening before closing.")

    const timeSlotDuration = integerValue(values.time_slot_duration, 30)
    const advanceBookingDays = integerValue(values.advance_booking_days, 30)
    const minAdvanceHours = integerValue(values.min_advance_hours, 2)
    const minPartySize = integerValue(values.min_party_size, 1)
    const maxPartySize = integerValue(values.max_party_size, 12)
    if (timeSlotDuration === null || timeSlotDuration < 1 || timeSlotDuration > 240) messages.push("Time slot duration must be an integer from 1 to 240.")
    if (advanceBookingDays === null || advanceBookingDays < 0 || advanceBookingDays > 365) messages.push("Advance booking days must be an integer from 0 to 365.")
    if (minAdvanceHours === null || minAdvanceHours < 0 || minAdvanceHours > 168) messages.push("Minimum advance hours must be an integer from 0 to 168.")
    if (minPartySize === null || minPartySize < 1) messages.push("Minimum party size must be a positive integer.")
    if (maxPartySize === null || maxPartySize < 1 || (minPartySize !== null && maxPartySize < minPartySize)) messages.push("Maximum party size must be at least the minimum party size.")

    const language = textValue(values.language).toLowerCase() || "en"
    if (!["en", "tr", "es"].includes(language)) messages.push("Language must be en, tr, or es.")
    const officialDomain = explicitDomain || normalizeOfficialDomain(website) || ""
    if (explicitDomain && website && normalizeOfficialDomain(website) !== explicitDomain) messages.push("Official domain does not match the official website URL.")

    const payload: RestaurantImportPayload = {
      name,
      business_contact_email: businessEmail,
      official_website_url: website || "",
      official_domain: officialDomain,
      slug,
      description: textValue(values.description) || null,
      cuisine: textValue(values.cuisine) || null,
      location: textValue(values.location) || null,
      phone: textValue(values.phone) || null,
      hours: textValue(values.hours) || null,
      atmosphere: textValue(values.atmosphere) || null,
      timezone: textValue(values.timezone) || "UTC",
      language,
      reservation_enabled: reservationEnabled === null ? true : reservationEnabled,
      opening_time: openingTime,
      closing_time: closingTime,
      time_slot_duration: timeSlotDuration === null ? 30 : timeSlotDuration,
      advance_booking_days: advanceBookingDays === null ? 30 : advanceBookingDays,
      min_advance_hours: minAdvanceHours === null ? 2 : minAdvanceHours,
      min_party_size: minPartySize === null ? 1 : minPartySize,
      max_party_size: maxPartySize === null ? 12 : maxPartySize,
      meal_only_reservations: mealOnly === null ? false : mealOnly,
    }
    const hardErrors = messages.filter((message) => !message.includes("collided"))
    const status = hardErrors.length > 0 ? "error" : messages.length > 0 ? "warning" : "ready"
    result.push({
      excelRowNumber: row.excelRowNumber,
      payload,
      providedFields: row.providedFields || restaurantImportColumns.map((column) => column.key),
      status,
      messages,
    })
  }
  return result
}

export async function parseRestaurantImportFile(buffer: Uint8Array, context: ImportValidationContext = {}) {
  if (buffer.length > RESTAURANT_IMPORT_MAX_BYTES) throw new Error("The Excel file is larger than the 10 MB limit.")
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(await normalizePrefixedExcelXml(buffer) as any)
  } catch {
    throw new Error("The uploaded file is not a readable .xlsx workbook.")
  }
  if ((workbook as ExcelJS.Workbook & { vbaProject?: unknown }).vbaProject) throw new Error("Macro-enabled workbooks are not accepted.")
  if (workbook.worksheets.length === 0) throw new Error("The workbook has no worksheets.")
  const sheet = workbook.getWorksheet("Restaurants") || workbook.worksheets[0]
  const headerRow = sheet.getRow(1)
  const headerMap = new Map<string, number>()
  headerRow.eachCell((cell, columnNumber) => headerMap.set(headerKey(cell.value), columnNumber))
  const missing = restaurantImportColumns.filter((column) => column.required && !headerMap.has(headerKey(column.header)))
  if (missing.length > 0) throw new Error(`Missing required columns: ${missing.map((column) => column.header).join(", ")}`)

  const rows: RestaurantImportValidationRow[] = []
  let nonEmptyRows = 0
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values: Record<string, unknown> = {}
    const providedFields: Array<keyof RestaurantImportPayload> = []
    let hasValue = false
    let formulaFound = false
    for (const column of restaurantImportColumns) {
      const columnNumber = headerMap.get(headerKey(column.header))
      if (!columnNumber) continue
      const cell = row.getCell(columnNumber)
      if (typeof cell.value === "object" && cell.value !== null && "formula" in cell.value) {
        values[column.key] = "="
        providedFields.push(column.key)
        formulaFound = true
        hasValue = true
      } else {
        values[column.key] = cell.value
        const hasCellValue = cell.value !== null && cell.value !== undefined && Boolean(textValue(cell.value))
        if (hasCellValue) providedFields.push(column.key)
        hasValue ||= hasCellValue
      }
    }
    if (formulaFound) values.__formula_cell__ = true
    if (hasValue) {
      nonEmptyRows += 1
      if (nonEmptyRows <= RESTAURANT_IMPORT_MAX_ROWS) rows.push({ excelRowNumber: rowNumber, values, providedFields })
    }
  })
  if (nonEmptyRows > RESTAURANT_IMPORT_MAX_ROWS) throw new Error(`The workbook contains more than the ${RESTAURANT_IMPORT_MAX_ROWS}-row limit.`)
  return validateRestaurantImportRows(rows, context)
}

export async function buildRestaurantImportTemplate() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Reservevia"
  workbook.created = new Date()
  const restaurants = workbook.addWorksheet("Restaurants")
  restaurants.views = [{ state: "frozen", ySplit: 1 }]
  restaurants.columns = restaurantTemplateColumns.map((column) => ({ header: column.header, key: column.key, width: Math.min(36, Math.max(18, column.header.length + 4)) }))
  restaurants.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + restaurantTemplateColumns.length)}1` }
  restaurants.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  restaurants.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17142D" } }
  restaurants.getRow(1).alignment = { vertical: "middle", wrapText: true }
  restaurants.getRow(1).height = 30

  const instructions = workbook.addWorksheet("Instructions")
  instructions.views = [{ state: "frozen", ySplit: 1 }]
  instructions.columns = [
    { header: "Field", key: "field", width: 28 },
    { header: "Required", key: "required", width: 12 },
    { header: "Description", key: "description", width: 55 },
    { header: "Accepted format", key: "format", width: 32 },
    { header: "Example", key: "example", width: 30 },
    { header: "Default", key: "defaultValue", width: 30 },
  ]
  instructions.addRow({ field: "How to use this template", description: "Fill one restaurant per row in the Restaurants sheet. Only the three required fields are needed; optional fields can be left blank. The importer also accepts the previous full 22-column workbook format." })
  for (const column of restaurantTemplateColumns) instructions.addRow({ field: column.header, required: column.required ? "Yes" : "No", description: column.description, format: column.format, example: column.example, defaultValue: column.defaultValue || "" })
  instructions.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  instructions.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17142D" } }
  instructions.getRow(2).font = { italic: true, color: { argb: "FF475569" } }
  instructions.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; row.height = 32 })
  return workbook.xlsx.writeBuffer()
}
