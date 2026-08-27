import { Link2 } from "lucide-react"
import { getManagementContext } from "@/lib/management-context"
import { getRestaurantDomainManagementData } from "@/lib/domains/domain-service"
import { getCustomRestaurantUrl, getHostedRestaurantUrl } from "@/lib/domains/public-url"
import { isVercelProviderConfigured } from "@/lib/domains/vercel"
import { DomainManagement, type DomainManagementEntry } from "@/components/manage/domain-management"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"

export const dynamic = "force-dynamic"

export default async function DomainsPage() {
  const language = await getServerLanguage()
  const t = (key: Parameters<typeof translateServer>[1]) => translateServer(language, key)
  const context = await getManagementContext()
  const restaurantIds = context?.restaurants.map((restaurant) => restaurant.id) || []
  const entries = (await Promise.all(restaurantIds.map(async (restaurantId) => {
    try {
      const data = await getRestaurantDomainManagementData(restaurantId)
      if (!data.restaurant.workspace_id) return null
      return {
        restaurant: {
          id: data.restaurant.id,
          name: data.restaurant.name,
          slug: data.restaurant.slug,
          workspace_id: data.restaurant.workspace_id,
          status: data.restaurant.status,
        },
        domain: data.domain
          ? {
              id: data.domain.id,
              restaurant_id: data.domain.restaurant_id,
              public_surface: data.domain.public_surface,
              hostname: data.domain.hostname,
              status: data.domain.status,
              verification_state: data.domain.verification_state,
              provider_verified: data.domain.provider_verified,
              dns_configured: data.domain.dns_configured,
              last_checked_at: data.domain.last_checked_at,
              last_error_code: data.domain.last_error_code,
              last_error_message: data.domain.last_error_message,
              verified_at: data.domain.verified_at,
            }
          : null,
        hostedUrl: getHostedRestaurantUrl(data.restaurant.slug),
              preferredUrl: data.domain && data.customDomainEnabled && data.domain.status === "active" && data.domain.provider_verified && data.domain.dns_configured
                ? getCustomRestaurantUrl(data.domain.hostname)
                : getHostedRestaurantUrl(data.restaurant.slug),
        customDomainEnabled: data.customDomainEnabled,
        customDomainTarget: data.customDomainTarget,
        providerConfigured: isVercelProviderConfigured(),
        customDomainSetupConfigured: Boolean(data.customDomainTarget),
        instructions: data.instructions,
      } satisfies DomainManagementEntry
    } catch {
      // A direct URL must not reveal domain configuration to a role that is
      // not allowed to manage it. The rest of the management app remains
      // available to operational roles.
      return null
    }
  }))).filter((entry): entry is DomainManagementEntry => Boolean(entry))

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Link2 className="h-5 w-5" /></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">Reservevia</p><h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{t("manage.domains.title")}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("manage.domains.description")}</p></div>
        </div>
        <DomainManagement entries={entries} />
      </div>
    </div>
  )
}
