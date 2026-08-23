export const CORE_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "FEATURE_NOT_INCLUDED",
  "LIMIT_REACHED",
  "PLAN_UNAVAILABLE",
  "BILLING_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "DOMAIN_ERROR",
  "INVITATION_INVALID",
  "CONFLICT",
  "RATE_LIMITED",
] as const

export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number]

export class CoreError extends Error {
  readonly code: CoreErrorCode
  readonly details: Record<string, unknown>

  constructor(code: CoreErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = "CoreError"
    this.code = code
    this.details = details
  }
}

export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError
}
