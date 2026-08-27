import type { FeatureKey, LimitKey, PlanKey } from "@/lib/entitlements"

export type PublicPlanCatalogRow = {
  key: string
  name: string
  monthly_price_usd_cents: number
  sort_order: number
  restaurant_limit: number
  user_limit: number
  reservation_limit: number | null
  history_days: number | null
  features: unknown
}

export type MarketingPlan = {
  key: PlanKey
  name: string
  sortOrder: number
  priceCents: number
  price: string
  restaurantLimit: number
  userLimit: number
  reservationLimit: number | null
  historyDays: number | null
  reservationLabel: string
  historyLabel: string
  target: string
  description: string
  features: Partial<Record<FeatureKey, boolean>>
  featureKeys: FeatureKey[]
  featureLabels: string[]
}

export type MarketingHighlightDefinition =
  | { kind: "limit"; key: "restaurants" | "users" | "reservationsPerMonth" }
  | { kind: "feature"; key: FeatureKey }

export type MarketingComparisonSectionKey =
  | "reservations"
  | "restaurantTeam"
  | "guestExperience"
  | "brandingDomains"
  | "analyticsReports"
  | "notifications"
  | "integrations"
  | "aiAgents"
  | "support"

export type MarketingComparisonRow =
  | { key: "restaurants" | "users" | "reservationsPerMonth" | "reservationHistory"; kind: "limit"; limit: LimitKey }
  | { key: string; kind: "feature"; feature: FeatureKey }
  | { key: "bookingChannels" | "publicAgentSurfaces" | "docsAndGuidance"; kind: "platform" }

export const MARKETING_PLAN_DISPLAY_PRIORITY: Partial<Record<PlanKey, number>> = {
  pro: 0,
  starter: 1,
  business: 2,
  free: 3,
}

const COMPACT_PLAN_HIGHLIGHTS: Record<PlanKey, MarketingHighlightDefinition[]> = {
  free: [
    { kind: "limit", key: "restaurants" },
    { kind: "limit", key: "users" },
    { kind: "limit", key: "reservationsPerMonth" },
    { kind: "feature", key: "emailNotifications" },
    { kind: "feature", key: "pushNotifications" },
  ],
  starter: [
    { kind: "limit", key: "restaurants" },
    { kind: "limit", key: "users" },
    { kind: "limit", key: "reservationsPerMonth" },
    { kind: "feature", key: "customDomain" },
    { kind: "feature", key: "csvExport" },
  ],
  pro: [
    { kind: "limit", key: "restaurants" },
    { kind: "limit", key: "users" },
    { kind: "limit", key: "reservationsPerMonth" },
    { kind: "feature", key: "advancedReports" },
    { kind: "feature", key: "customPWA" },
  ],
  business: [
    { kind: "limit", key: "restaurants" },
    { kind: "limit", key: "users" },
    { kind: "limit", key: "reservationsPerMonth" },
    { kind: "feature", key: "multiRestaurant" },
    { kind: "feature", key: "customDomain" },
  ],
}

export function getCompactPlanHighlights(plan: MarketingPlan) {
  return COMPACT_PLAN_HIGHLIGHTS[plan.key].filter((highlight) => highlight.kind === "limit" || plan.features[highlight.key] === true)
}

export const MARKETING_COMPARISON_SECTIONS: Array<{ key: MarketingComparisonSectionKey; rows: MarketingComparisonRow[] }> = [
  {
    key: "reservations",
    rows: [
      { key: "reservationsPerMonth", kind: "limit", limit: "reservationsPerPeriod" },
      { key: "reservationHistory", kind: "limit", limit: "historyDays" },
    ],
  },
  {
    key: "restaurantTeam",
    rows: [
      { key: "restaurants", kind: "limit", limit: "restaurants" },
      { key: "users", kind: "limit", limit: "users" },
      { key: "multiRestaurant", kind: "feature", feature: "multiRestaurant" },
    ],
  },
  {
    key: "guestExperience",
    rows: [
      { key: "hostedPage", kind: "feature", feature: "hostedRestaurantPage" },
      { key: "guestHistory", kind: "feature", feature: "guestHistory" },
    ],
  },
  {
    key: "brandingDomains",
    rows: [
      { key: "customDomain", kind: "feature", feature: "customDomain" },
      { key: "removeBranding", kind: "feature", feature: "removeReserveviaBranding" },
      { key: "customPWA", kind: "feature", feature: "customPWA" },
    ],
  },
  {
    key: "analyticsReports",
    rows: [
      { key: "basicAnalytics", kind: "feature", feature: "basicAnalytics" },
      { key: "csvExport", kind: "feature", feature: "csvExport" },
      { key: "advancedReports", kind: "feature", feature: "advancedReports" },
    ],
  },
  {
    key: "notifications",
    rows: [
      { key: "emailNotifications", kind: "feature", feature: "emailNotifications" },
      { key: "pushNotifications", kind: "feature", feature: "pushNotifications" },
      { key: "automatedNotifications", kind: "feature", feature: "automatedNotifications" },
    ],
  },
  {
    key: "integrations",
    rows: [{ key: "bookingChannels", kind: "platform" }],
  },
  {
    key: "aiAgents",
    rows: [{ key: "publicAgentSurfaces", kind: "platform" }],
  },
  {
    key: "support",
    rows: [{ key: "docsAndGuidance", kind: "platform" }],
  },
]

export function orderMarketingPlans(plans: MarketingPlan[]) {
  return [...plans].sort((a, b) => (MARKETING_PLAN_DISPLAY_PRIORITY[a.key] ?? 99) - (MARKETING_PLAN_DISPLAY_PRIORITY[b.key] ?? 99))
}

export const PLAN_MARKETING_COPY: Record<PlanKey, { target: string; description: string }> = {
  free: {
    target: "A real place to start taking reservations.",
    description: "Launch one restaurant page and manage your first bookings with a simple, dependable setup, including reservation alerts.",
  },
  starter: {
    target: "The first professional upgrade.",
    description: "Add your own domain, bring in a small team, keep more of your reservation history, and receive reservation push alerts.",
  },
  pro: {
    target: "For restaurants running reservations every day.",
    description: "Go further with unlimited reservations, richer reports, guest history, push, and a branded management app.",
  },
  business: {
    target: "A clear workspace for growing restaurant groups.",
    description: "Run up to three restaurants with one team, one workspace, separate public booking pages, and reservation push alerts.",
  },
}

export const MARKETING_FEATURE_LABELS: Record<FeatureKey, string> = {
  hostedRestaurantPage: "Hosted restaurant page",
  emailNotifications: "Reservation email notifications",
  removeReserveviaBranding: "Remove Reservevia branding",
  customDomain: "Custom booking domain",
  basicAnalytics: "Basic analytics",
  csvExport: "CSV export",
  guestHistory: "Guest history",
  automatedNotifications: "Automated notifications",
  advancedReports: "Advanced reports",
  customPWA: "Branded management app",
  pushNotifications: "Push notifications",
  multiRestaurant: "Multi-restaurant management",
}

const FEATURE_DISPLAY_ORDER: FeatureKey[] = [
  "hostedRestaurantPage",
  "customDomain",
  "emailNotifications",
  "removeReserveviaBranding",
  "basicAnalytics",
  "csvExport",
  "guestHistory",
  "automatedNotifications",
  "advancedReports",
  "customPWA",
  "pushNotifications",
  "multiRestaurant",
]

function isPlanKey(value: string): value is PlanKey {
  return ["free", "starter", "pro", "business"].includes(value)
}

function normalizeFeatures(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return FEATURE_DISPLAY_ORDER.reduce<Partial<Record<FeatureKey, boolean>>>((features, key) => {
    features[key] = source[key] === true
    return features
  }, {})
}

export function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export function formatLimit(value: number | null, unlimitedLabel = "Unlimited") {
  return value === null ? unlimitedLabel : value.toLocaleString("en-US")
}

export function formatHistory(value: number | null) {
  if (value === null) return "Unlimited"
  if (value === 365) return "1 year"
  return `${value} days`
}

export function buildMarketingPlan(row: PublicPlanCatalogRow): MarketingPlan | null {
  if (!isPlanKey(row.key)) return null
  const features = normalizeFeatures(row.features)
  const featureKeys = FEATURE_DISPLAY_ORDER.filter((key) => features[key])
  const featureLabels = featureKeys
    .map((key) => MARKETING_FEATURE_LABELS[key])

  return {
    key: row.key,
    name: row.name,
    sortOrder: row.sort_order,
    priceCents: Number(row.monthly_price_usd_cents),
    price: formatPrice(Number(row.monthly_price_usd_cents)),
    restaurantLimit: Number(row.restaurant_limit),
    userLimit: Number(row.user_limit),
    reservationLimit: row.reservation_limit === null ? null : Number(row.reservation_limit),
    historyDays: row.history_days === null ? null : Number(row.history_days),
    reservationLabel: `${formatLimit(row.reservation_limit)} reservations / month`,
    historyLabel: formatHistory(row.history_days),
    target: PLAN_MARKETING_COPY[row.key].target,
    description: PLAN_MARKETING_COPY[row.key].description,
    features,
    featureKeys,
    featureLabels,
  }
}

export function buildMarketingPlans(rows: PublicPlanCatalogRow[]) {
  return rows
    .map(buildMarketingPlan)
    .filter((plan): plan is MarketingPlan => Boolean(plan))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}
