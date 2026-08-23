export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info"
export type NavItem = { label: string; href: string; icon?: string; badge?: string }

export function responsiveEntityPresentation<T>(items: readonly T[], breakpoint = 768) {
  return { items: [...items], breakpoint, mobileMode: "cards" as const, desktopMode: "table" as const }
}

export function getStatusLabel(status: string): { label: string; tone: StatusTone } {
  if (["active", "verified", "connected", "processed", "pass"].includes(status)) return { label: status, tone: "success" }
  if (["past_due", "pending", "processing", "warning"].includes(status)) return { label: status, tone: "warning" }
  if (["failed", "error", "blocked"].includes(status)) return { label: status, tone: "danger" }
  return { label: status, tone: "neutral" }
}
