import Link from "next/link"
import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getPublicRestaurantClaimState, resolveClaimToken } from "@/lib/claimable-restaurants"
import { ClaimCompleteButton } from "@/components/claim/claim-complete-button"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"

export const dynamic = "force-dynamic"

export default async function ClaimRestaurantPage({ params, searchParams }: { params: Promise<{ restaurantId: string }>; searchParams?: Promise<{ token?: string }> }) {
  const { restaurantId } = await params
  const query = (await searchParams) || {}
  const state = await getPublicRestaurantClaimState(restaurantId)
  const tokenRow = query.token ? await resolveClaimToken(restaurantId, query.token) : null
  const language = await getServerLanguage()
  const t = (key: Parameters<typeof translateServer>[1], replacements?: Parameters<typeof translateServer>[2]) => translateServer(language, key, replacements)
  const supabase = await createSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  const redirectPath = `/claim/${encodeURIComponent(restaurantId)}${query.token ? `?token=${encodeURIComponent(query.token)}` : ""}`

  if (!state.restaurant || !state.isClaimable) {
    return <main className="flex min-h-screen items-center justify-center bg-stone-50 px-5"><section className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-7 text-center shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">Reservevia</p><h1 className="mt-3 text-2xl font-semibold text-stone-950">{t("public.claim.alreadyClaimedTitle")}</h1><p className="mt-2 text-sm leading-6 text-stone-600">{t("public.claim.unavailableDescription")}</p><Link href={`/r/${encodeURIComponent(state.restaurant?.slug || "")}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-stone-950"><ArrowLeft className="h-4 w-4" />{t("public.claim.viewRestaurantPage")}</Link></section></main>
  }

  return <main className="flex min-h-screen items-center justify-center bg-stone-50 px-5 py-10"><section className="w-full max-w-lg rounded-3xl border border-stone-200 bg-white p-7 shadow-sm sm:p-9"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><ShieldCheck className="h-5 w-5" /></div><p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-stone-500">{t("public.claim.eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">{t("public.claim.title", { restaurant: state.restaurant.name })}</h1><p className="mt-3 text-sm leading-6 text-stone-600">{t("public.claim.description")}</p>{tokenRow ? <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><p>{t("public.claim.linkedRequest")} {t("public.claim.linkedRequestDescription")}</p></div> : null}<div className="mt-7">{auth.user ? <ClaimCompleteButton restaurantId={restaurantId} token={query.token} /> : <div className="space-y-3"><Link href={`/login?redirect=${encodeURIComponent(redirectPath)}`} className="flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">{t("public.claim.signIn")}</Link><Link href={`/signup?redirect=${encodeURIComponent(redirectPath)}`} className="flex min-h-11 items-center justify-center rounded-xl border border-stone-200 px-4 text-sm font-semibold text-stone-800 hover:bg-stone-50">{t("public.claim.createAccount")}</Link></div>}</div><p className="mt-5 text-xs leading-5 text-stone-500">{t("public.claim.verificationNote")}</p><Link href={`/r/${encodeURIComponent(state.restaurant.slug)}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-stone-600 hover:text-stone-950"><ArrowLeft className="h-4 w-4" />{t("public.claim.backToRestaurant")}</Link></section></main>
}
