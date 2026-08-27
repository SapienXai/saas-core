import "server-only"

import { getHostedRestaurantUrl } from "@/lib/domains/public-url"
import { evaluateRestaurantAiReadiness, type AiReadinessRestaurant, type RestaurantAiReadiness } from "@/lib/ai/readiness-shared"

export type { AiReadinessRestaurant, RestaurantAiReadiness } from "@/lib/ai/readiness-shared"

export function getRestaurantAiReadiness(
  restaurant: AiReadinessRestaurant,
  options: { canonicalUrl?: string | null } = {},
): RestaurantAiReadiness {
  const canonicalUrl = options.canonicalUrl ?? (restaurant.slug ? getHostedRestaurantUrl(restaurant.slug) : null)
  return evaluateRestaurantAiReadiness(restaurant, canonicalUrl)
}
