import { z } from "zod"

export const restaurantIdSchema = z.string().uuid()
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
export const timeSchema = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/, "Use HH:MM.")

export const guestFields = ["name", "phone", "email", "notes", "dietary_requirements"] as const
export const guestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  email: z.string().trim().email().max(254).optional(),
  notes: z.string().trim().max(1000).optional(),
  dietary_requirements: z.string().trim().max(1000).optional(),
}).strict()

export const restaurantSearchSchema = z.object({
  query: z.string().trim().max(120).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radius: z.number().positive().max(100).optional(),
  locality: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  party_size: z.number().int().positive().max(100).optional(),
  date: isoDateSchema.optional(),
  preferred_time: timeSchema.optional(),
  page_size: z.number().int().min(1).max(50).default(20),
  page_token: z.string().max(500).optional(),
}).strict()

export const availabilitySchema = z.object({
  restaurant_id: restaurantIdSchema,
  date: isoDateSchema,
  party_size: z.number().int().positive().max(100),
  preferred_time: timeSchema.optional(),
  reservation_area_id: restaurantIdSchema.optional(),
}).strict()

export const holdSchema = availabilitySchema.extend({
  ttl_seconds: z.number().int().min(30).max(600).default(180),
}).strict()

export const reservationCreateSchema = z.object({
  restaurant_id: restaurantIdSchema,
  reservation_area_id: restaurantIdSchema.optional(),
  hold_id: restaurantIdSchema.optional(),
  slot_id: z.string().trim().min(8).max(300).optional(),
  date: isoDateSchema,
  time: timeSchema,
  party_size: z.number().int().positive().max(100),
  guest: guestSchema,
  reservation_type: z.enum(["meal", "drinks"]).default("meal"),
  source_channel: z.enum(["agent_rest", "mcp", "openai"]).default("agent_rest"),
}).strict()

export const reservationModifySchema = z.object({
  reservation_id: restaurantIdSchema,
  date: isoDateSchema.optional(),
  time: timeSchema.optional(),
  party_size: z.number().int().positive().max(100).optional(),
  guest: guestSchema.partial().optional(),
}).strict()

export const reservationCancelSchema = z.object({
  reservation_id: restaurantIdSchema,
  reason: z.string().trim().max(500).optional(),
}).strict()

export type RestaurantSearchInput = z.infer<typeof restaurantSearchSchema>
export type AvailabilityInput = z.infer<typeof availabilitySchema>
export type HoldInput = z.infer<typeof holdSchema>
export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>
export type ReservationModifyInput = z.infer<typeof reservationModifySchema>

export type ApiErrorCode =
  | "RESTAURANT_NOT_FOUND"
  | "RESTAURANT_NOT_BOOKABLE"
  | "INVALID_PARTY_SIZE"
  | "INVALID_DATE"
  | "NO_AVAILABILITY"
  | "SLOT_NO_LONGER_AVAILABLE"
  | "HOLD_EXPIRED"
  | "HOLD_NOT_FOUND"
  | "HOLD_UNAVAILABLE"
  | "MISSING_REQUIRED_GUEST_DATA"
  | "RESERVATION_CONFLICT"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_ALREADY_CANCELLED"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_CONFLICT"
  | "UNAUTHORIZED_CLIENT"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR"

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode
    message: string
    retryable: boolean
    suggested_action?: string
    request_id?: string
  }
}

export class ApiDomainError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly suggestedAction?: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = "ApiDomainError"
  }
}

export function apiErrorBody(error: unknown, requestId?: string): ApiErrorBody {
  if (error instanceof ApiDomainError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.suggestedAction ? { suggested_action: error.suggestedAction } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    }
  }
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "ReserveVia could not complete the request.",
      retryable: true,
      suggested_action: "retry_request",
      ...(requestId ? { request_id: requestId } : {}),
    },
  }
}

export function apiErrorResponse(error: unknown, requestId?: string) {
  const body = apiErrorBody(error, requestId)
  const status = error instanceof ApiDomainError ? error.status : 500
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "x-request-id": requestId || "unknown" })
  if (error instanceof ApiDomainError && error.code === "RATE_LIMITED") headers.set("retry-after", "60")
  return Response.json(body, { status, headers })
}

export function parseApiSchema<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) throw new ApiDomainError("INVALID_REQUEST", "The request parameters are invalid.", false, "fix_request", 400)
  return result.data
}

export function jsonApiResponse<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  return Response.json(data, { ...init, headers })
}
