"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Globe2,
  Link2,
  LockKeyhole,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import { localeConfig } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  connectRestaurantDomainAction,
  refreshRestaurantDomainAction,
  removeRestaurantDomainAction,
} from "@/app/manage/domains/actions"
import { getDomainStatus, type DomainStatus } from "@/lib/domains/domain-state"
import { getCustomerHostnameParts, tryNormalizeHostname } from "@/lib/domains/hostname"
import { getPlanNavigationHref } from "@/lib/plan-navigation"

type DomainRecord = {
  id: string
  restaurant_id: string
  public_surface: "restaurant" | "brand"
  hostname: string
  status: string
  verification_state: string
  provider_verified: boolean
  dns_configured: boolean
  last_checked_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  verified_at: string | null
}

type DomainInstructions = {
  verification: Array<{ type: string; domain: string; value: string; reason: string }>
  configuredBy: string | null
  misconfigured: boolean | null
  recommendedIPv4: Array<{ rank: number; value: string[] }>
  recommendedCNAME: Array<{ rank: number; value: string }>
} | null

export type DomainManagementEntry = {
  restaurant: { id: string; name: string; slug: string; workspace_id: string; status: string }
  domain: DomainRecord | null
  instructions: DomainInstructions
  hostedUrl: string
  preferredUrl: string
  customDomainEnabled: boolean
  providerConfigured: boolean
  customDomainTarget: string | null
  customDomainSetupConfigured: boolean
}

type DomainOperationResult = {
  success: boolean
  code?: string
  message?: string
  domain?: DomainRecord
  instructions?: DomainInstructions
}

function StatusBadge({ status, label }: { status: DomainStatus; label: string }) {
  const styles: Record<DomainStatus, string> = {
    connected: "border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200",
    pending: "border-amber-200/70 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200",
    invalid: "border-orange-200/70 bg-orange-50 text-orange-700 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-200",
    failed: "border-rose-200/70 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200",
    suspended: "border-orange-200/70 bg-orange-50 text-orange-700 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-200",
    "not-connected": "border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300",
  }

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${styles[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === "connected" ? "bg-emerald-500" : status === "failed" ? "bg-rose-500" : status === "invalid" ? "bg-orange-500" : status === "pending" ? "bg-amber-500" : "bg-slate-400"}`} />
      {label}
    </span>
  )
}

function getDnsHost(hostname: string) {
  return getCustomerHostnameParts(hostname)?.dnsHost || "@"
}

function getPrimaryDnsRecord(hostname: string, target: string | null) {
  const parts = getCustomerHostnameParts(hostname)
  if (!parts || parts.isApex || !target) return null
  return {
    type: "CNAME",
    host: parts.dnsHost,
    value: target,
    ttl: "Auto",
    label: "Primary CNAME record",
  }
}

function CopyButton({
  value,
  id,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  value: string
  id: string
  copied: string | null
  copyLabel: string
  copiedLabel: string
  onCopy: (id: string, value: string) => void
}) {
  const isCopied = copied === id
  return (
    <button
      type="button"
      onClick={() => onCopy(id, value)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:border-violet-300 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:border-violet-400/40 dark:hover:text-violet-200"
      aria-label={`${isCopied ? copiedLabel : copyLabel}: ${value}`}
    >
      {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {isCopied ? copiedLabel : copyLabel}
    </button>
  )
}

function ConnectionTimeline({
  domain,
  labels,
}: {
  domain: DomainRecord | null
  labels: {
    domain: string
    domainDetail: string
    dns: string
    dnsDetail: string
    live: string
    liveDetail: string
  }
}) {
  const steps = [
    { label: labels.domain, detail: labels.domainDetail, done: Boolean(domain) },
    { label: labels.dns, detail: labels.dnsDetail, done: Boolean(domain?.dns_configured) },
    { label: labels.live, detail: labels.liveDetail, done: Boolean(domain?.status === "active" && domain.provider_verified && domain.dns_configured) },
  ]

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.035]">
      <div className="space-y-4">
        {steps.map((step, index) => (
          <div key={step.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${step.done ? "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/15 dark:text-emerald-200" : "border-slate-200 bg-white text-slate-400 dark:border-white/10 dark:bg-white/[0.06]"}`}>
                {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              {index < steps.length - 1 && <span className={`mt-1 h-full min-h-5 w-px ${steps[index + 1].done ? "bg-emerald-300 dark:bg-emerald-400/40" : "bg-slate-200 dark:bg-white/10"}`} />}
            </div>
            <div className="pb-1">
              <p className={`text-sm font-bold ${step.done ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}>{step.label}</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DomainManagement({ entries }: { entries: DomainManagementEntry[] }) {
  const { currentLang, getTranslation, translateMessage } = useLanguage()
  const { currentWorkspace, ownedWorkspaceId } = useManageContext()
  const planHref = getPlanNavigationHref({ currentWorkspaceId: currentWorkspace?.id, ownedWorkspaceId })
  const [selectedId, setSelectedId] = useState(entries[0]?.restaurant.id || "")
  const [hostname, setHostname] = useState("")
  const [publicSurface, setPublicSurface] = useState<"restaurant" | "brand">(entries[0]?.domain?.public_surface || "restaurant")
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null)
  const [instructions, setInstructions] = useState<DomainInstructions>(entries[0]?.instructions || null)
  const [copied, setCopied] = useState<string | null>(null)
  const [localDomain, setLocalDomain] = useState<DomainRecord | null | undefined>(undefined)
  const [isPending, startTransition] = useTransition()

  const selected = useMemo(() => entries.find((entry) => entry.restaurant.id === selectedId) || entries[0], [entries, selectedId])

  useEffect(() => {
    setLocalDomain(undefined)
    setInstructions(selected?.instructions || null)
    setFeedback(null)
    setHostname("")
    setPublicSurface(selected?.domain?.public_surface || "restaurant")
  }, [selected?.restaurant.id, selected?.instructions, selected?.domain?.public_surface])

  if (!selected) {
    return <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">{getTranslation("manage.domains.noRestaurant")}</p>
  }

  const domain = localDomain === undefined ? selected.domain : localDomain
  const status = getDomainStatus(domain, selected.customDomainEnabled, instructions)
  const isLive = status === "connected"
  const enteredHostname = tryNormalizeHostname(hostname)
  const enteredParts = enteredHostname ? getCustomerHostnameParts(enteredHostname) : null
  const primaryRecord = domain ? getPrimaryDnsRecord(domain.hostname, selected.customDomainTarget) : null
  const liveUrl = isLive && domain ? `https://${domain.hostname}` : selected.preferredUrl
  const additionalDnsRecords = domain && instructions
    ? [
        ...instructions.verification.map((record) => ({
          id: `verification-${record.type}-${record.domain}-${record.value}`,
          type: record.type,
          domain: record.domain,
          value: record.value,
        })),
        ...instructions.recommendedCNAME.slice(1).map((record) => ({
          id: `recommended-cname-${record.rank}-${record.value}`,
          type: "CNAME",
          domain: getDnsHost(domain.hostname),
          value: record.value,
        })),
        ...instructions.recommendedIPv4.flatMap((record) => record.value.map((value) => ({
          id: `recommended-a-${record.rank}-${value}`,
          type: "A",
          domain: getDnsHost(domain.hostname),
          value,
        }))),
      ]
    : []
  const checkedAt = domain?.last_checked_at ? new Date(domain.last_checked_at) : null
  const checkedAtLabel = checkedAt && !Number.isNaN(checkedAt.valueOf())
    ? checkedAt.toLocaleString(localeConfig[currentLang].intl, { dateStyle: "medium", timeStyle: "short" })
    : getTranslation("manage.domains.never")
  const statusLabel = {
    connected: getTranslation("manage.domains.statusConnected"),
    pending: domain?.provider_verified && !domain.dns_configured
      ? getTranslation("manage.domains.statusProvisioning")
      : getTranslation("manage.domains.statusPending"),
    invalid: getTranslation("manage.domains.statusInvalid"),
    failed: getTranslation("manage.domains.statusFailed"),
    suspended: getTranslation("manage.domains.statusSuspended"),
    "not-connected": getTranslation("manage.domains.statusNotConnected"),
  }[status]

  const copyText = async (id: string, value: string) => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(id)
      window.setTimeout(() => setCopied((current) => current === id ? null : current), 1800)
    } catch {
      setFeedback({ kind: "error", message: getTranslation("manage.domains.messageCopyFailed") })
    }
  }

  const getActionErrorMessage = (result: DomainOperationResult) => {
    const messages: Record<string, string> = {
      INVALID_HOSTNAME: getTranslation("manage.domains.errorInvalidHostname"),
      ENTITLEMENT: getTranslation("manage.domains.errorEntitlement"),
      CONFLICT: getTranslation("manage.domains.errorConflict"),
      DOMAIN_ALREADY_OWNED: getTranslation("manage.domains.errorDomainOwned"),
      DOMAIN_RELEASING: getTranslation("manage.domains.errorDomainReleasing"),
      DOMAIN_LOCAL_CONFLICT: getTranslation("manage.domains.errorDomainLocalConflict"),
      DOMAIN_MAPPING_CONFLICT: getTranslation("manage.domains.errorRestaurantDomainConflict"),
      APEX_NOT_SUPPORTED: getTranslation("manage.domains.errorApexNotSupported"),
      NOT_FOUND: getTranslation("manage.domains.errorNotFound"),
      CONFIGURATION: getTranslation("manage.domains.errorConfiguration"),
      PROVIDER: getTranslation("manage.domains.errorProvider"),
    }
    return (result.code && messages[result.code]) || translateMessage(result.message || getTranslation("manage.domains.messageFailed"))
  }

  const getSuccessMessage = (operation: "connect" | "refresh" | "remove", nextDomain: DomainRecord | null, nextInstructions: DomainInstructions) => {
    if (operation === "remove") return getTranslation("manage.domains.messageRemoved")
    const nextStatus = getDomainStatus(nextDomain, selected.customDomainEnabled, nextInstructions)
    if (operation === "connect") return nextStatus === "connected" ? getTranslation("manage.domains.messageVerified") : getTranslation("manage.domains.messageAdded")
    if (nextStatus === "connected") return getTranslation("manage.domains.messageVerified")
    if (nextStatus === "invalid") return getTranslation("manage.domains.messageInvalid")
    if (nextStatus === "failed") return getTranslation("manage.domains.messageCheckFailed")
    return getTranslation("manage.domains.messagePending")
  }

  const run = (operation: () => Promise<DomainOperationResult>, operationType: "connect" | "refresh" | "remove" = "refresh") => {
    setFeedback(null)
    startTransition(async () => {
      try {
        const result = await operation()
        if (!result.success) {
          setFeedback({ kind: "error", message: getActionErrorMessage(result) })
          return
        }
        const nextDomain = operationType === "remove" ? null : result.domain || domain
        const nextInstructions = operationType === "remove" ? null : result.instructions || instructions
        setLocalDomain(nextDomain)
        setInstructions(nextInstructions)
        setFeedback({ kind: "success", message: getSuccessMessage(operationType, nextDomain, nextInstructions) })
      } catch (error) {
        console.error("Reservevia custom domain client action failed", error)
        setFeedback({ kind: "error", message: getTranslation("manage.domains.messageFailed") })
      }
    })
  }

  const connect = () => {
    const value = hostname.trim()
    if (!value) return
    run(() => connectRestaurantDomainAction(selected.restaurant.id, value, publicSurface), "connect")
  }

  const refresh = () => {
    run(() => refreshRestaurantDomainAction(selected.restaurant.id), "refresh")
  }

  const remove = () => {
    if (!domain || !window.confirm(`${getTranslation("manage.domains.remove")} “${domain.hostname}”?`)) return
    run(() => removeRestaurantDomainAction(selected.restaurant.id), "remove")
  }

  return (
    <div className="space-y-5">
      {entries.length > 1 && (
        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
          {getTranslation("manage.domains.restaurant")}
          <select
            value={selected.restaurant.id}
            onChange={(event) => setSelectedId(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
          >
            {entries.map((entry) => <option key={entry.restaurant.id} value={entry.restaurant.id}>{entry.restaurant.name}</option>)}
          </select>
        </label>
      )}

      <section className="relative overflow-hidden rounded-[1.5rem] bg-[#12172a] p-5 text-white shadow-[0_18px_45px_rgba(76,29,149,0.16)] sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 left-1/3 h-64 w-64 rounded-full bg-indigo-400/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="max-w-xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-violet-200">
              <Sparkles className="h-3.5 w-3.5" />
              {getTranslation("manage.domains.eyebrow")}
            </div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{getTranslation("manage.domains.heroTitle")}</h2>
            <p className="mt-2 max-w-lg text-sm leading-5 text-indigo-100/70">{getTranslation("manage.domains.heroDescription")}</p>
          </div>
          <StatusBadge status={status} label={statusLabel} />
        </div>

        <div className="relative mt-5 grid gap-2.5 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.07] p-3.5 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-100/60"><Globe2 className="h-3.5 w-3.5" />{getTranslation("manage.domains.hostedUrl")}</div>
            <a
              href={selected.hostedUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 flex min-w-0 items-center gap-1.5 text-sm font-bold text-white underline decoration-white/30 underline-offset-4 transition hover:text-violet-100 hover:decoration-white/70"
              title={selected.hostedUrl}
              aria-label={getTranslation("manage.domains.openUrl", { url: selected.hostedUrl })}
            >
              <span className="truncate">{selected.hostedUrl}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </a>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.07] p-3.5 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-100/60"><Link2 className="h-3.5 w-3.5" />{getTranslation("manage.domains.customDomain")}</div>
            <p className="mt-2 truncate text-sm font-bold text-white" title={domain?.hostname}>{domain?.hostname || getTranslation("manage.domains.notSet")}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.07] p-3.5 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-100/60"><LockKeyhole className="h-3.5 w-3.5" />{getTranslation("manage.domains.sslStatus")}</div>
            <p className={`mt-2 text-sm font-bold ${isLive ? "text-emerald-300" : "text-amber-200"}`}>{isLive ? getTranslation("manage.domains.active") : statusLabel}</p>
          </div>
        </div>
      </section>

      {feedback && (
        <div className={`flex items-start gap-3 rounded-2xl border p-4 text-sm font-semibold shadow-sm ${feedback.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100" : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100"}`} role={feedback.kind === "error" ? "alert" : "status"}>
          {feedback.kind === "success" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" /> : <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-300" />}
          <p>{feedback.message}</p>
        </div>
      )}

      {!selected.customDomainEnabled ? (
        <section className="rounded-3xl border border-amber-200/80 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100 sm:p-6">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div><p className="font-bold">{getTranslation("manage.domains.planNotice")}</p><Link href={planHref} className="mt-2 inline-flex items-center gap-1 font-bold underline decoration-amber-400 underline-offset-4">{getTranslation("manage.domains.viewPlan")}<ArrowRight className="h-3.5 w-3.5" /></Link></div>
          </div>
        </section>
      ) : !selected.providerConfigured ? (
        <section className="rounded-3xl border border-amber-200/80 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100 sm:p-6">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div>
              <p className="font-bold">{getTranslation("manage.domains.providerSetupTitle")}</p>
              <p className="mt-2 leading-6 text-amber-900/80 dark:text-amber-100/80">{getTranslation("manage.domains.providerSetupDescription")}</p>
            </div>
          </div>
        </section>
      ) : !selected.customDomainSetupConfigured ? (
        <section className="rounded-3xl border border-amber-200/80 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100 sm:p-6">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div>
              <p className="font-bold">{getTranslation("manage.domains.providerSetupTitle")}</p>
              <p className="mt-2 leading-6 text-amber-900/80 dark:text-amber-100/80">{getTranslation("manage.domains.customDomainSetupMissing")}</p>
            </div>
          </div>
        </section>
      ) : (
        <div className={domain && isLive ? "grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]" : undefined}>
          <section className="min-w-0 rounded-[1.5rem] border border-slate-200/80 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-5">
            {!domain ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Globe2 className="h-5 w-5" /></div>
                  <div><h3 className="text-lg font-bold tracking-tight text-slate-950 dark:text-white">{getTranslation("manage.domains.connectTitle")}</h3><p className="mt-1 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">{getTranslation("manage.domains.connectDescription")}</p></div>
                </div>
                <div className="mt-5">
                  <label htmlFor="custom-hostname" className="text-sm font-bold text-slate-800 dark:text-slate-100">{getTranslation("manage.domains.domainLabel")}</label>
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                    <div className="relative min-w-0 flex-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-slate-400">https://</span><Input id="custom-hostname" value={hostname} onChange={(event) => setHostname(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") connect() }} placeholder={getTranslation("manage.domains.domainPlaceholder")} autoComplete="off" className="h-11 rounded-xl border-slate-200 pl-[4.25rem] text-sm shadow-none focus-visible:border-violet-500 focus-visible:ring-violet-500/20 dark:border-white/10" /></div>
                    <Button type="button" onClick={connect} loading={isPending} disabled={!hostname.trim()} className="h-11 shrink-0 rounded-xl bg-violet-600 px-4 font-bold shadow-md shadow-violet-600/20 hover:bg-violet-700">{!isPending && <ShieldCheck className="h-4 w-4" />}{isPending ? getTranslation("manage.domains.connecting") : getTranslation("manage.domains.connectButton")}</Button>
                  </div>
                  <label htmlFor="custom-domain-surface" className="mt-4 block max-w-md text-sm font-bold text-slate-800 dark:text-slate-100">{getTranslation("manage.domains.publicSurface")}
                    <select id="custom-domain-surface" value={publicSurface} onChange={(event) => setPublicSurface(event.target.value as "restaurant" | "brand")} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
                      <option value="restaurant">{getTranslation("manage.domains.restaurantSurface")}</option>
                      <option value="brand">{getTranslation("manage.domains.brandSurface")}</option>
                    </select>
                  </label>
                  <p className="mt-2.5 flex items-start gap-2 text-xs leading-5 text-slate-500 dark:text-slate-400"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />{getTranslation("manage.domains.domainHint")}</p>
                  {enteredParts && (
                    enteredParts.isApex ? (
                      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{getTranslation("manage.domains.apexNotSupported")}</p>
                      </div>
                    ) : selected.customDomainTarget ? (
                      <div className="mt-3 rounded-xl border border-violet-200/80 bg-violet-50/70 p-3 dark:border-violet-400/20 dark:bg-violet-500/10">
                        <div className="flex items-start gap-3"><Server className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-200" /><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-violet-900 dark:text-violet-100">{getTranslation("manage.domains.dnsPreviewTitle")}</p><p className="mt-1 text-xs leading-5 text-violet-900/70 dark:text-violet-100/70">{getTranslation("manage.domains.dnsPreviewDescription")}</p></div></div>
                        <div className="mt-2.5 grid gap-px overflow-hidden rounded-lg border border-violet-200/80 bg-violet-200/80 dark:border-violet-400/20 dark:bg-violet-400/20 sm:grid-cols-4">
                          {[
                            [getTranslation("manage.domains.recordType"), "CNAME"],
                            [getTranslation("manage.domains.recordHost"), enteredParts.dnsHost],
                            [getTranslation("manage.domains.recordValue"), selected.customDomainTarget],
                            [getTranslation("manage.domains.recordTtl"), "Auto"],
                          ].map(([label, value]) => <div key={label} className="bg-white p-2.5 dark:bg-[#171827]"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-1 break-all font-mono text-xs font-bold text-slate-800 dark:text-slate-100">{value}</p></div>)}
                        </div>
                      </div>
                    ) : null
                  )}
                  <ul className="mt-3 grid gap-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400 sm:grid-cols-3 sm:gap-x-4">
                    <li>• {getTranslation("manage.domains.dnsHostHelp")}</li>
                    <li>• {getTranslation("manage.domains.dnsExistingHelp")}</li>
                    <li>• {getTranslation("manage.domains.dnsPropagationHelp")}</li>
                  </ul>
                </div>
                <div className="mt-5 grid gap-2 border-t border-slate-100 pt-4 dark:border-white/10 sm:grid-cols-3">
                  {[{ icon: Link2, title: getTranslation("manage.domains.stepDomain"), text: getTranslation("manage.domains.stepDomainDetail") }, { icon: Server, title: getTranslation("manage.domains.stepDns"), text: getTranslation("manage.domains.stepDnsDetail") }, { icon: CheckCircle2, title: getTranslation("manage.domains.stepLive"), text: getTranslation("manage.domains.stepLiveDetail") }].map(({ icon: Icon, title, text }) => <div key={title} className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3 dark:bg-white/[0.04]"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" /><div><p className="text-xs font-bold text-slate-800 dark:text-slate-100">{title}</p><p className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{text}</p></div></div>)}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isLive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200"}`}><Link2 className="h-5 w-5" /></div>
                    <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{getTranslation("manage.domains.customDomain")}</p><h3 className="mt-1 truncate text-xl font-bold tracking-tight text-slate-950 dark:text-white">{domain.hostname}</h3><div className="mt-2"><StatusBadge status={status} label={statusLabel} /></div></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={refresh} loading={isPending} className="h-9 rounded-xl border-slate-200 bg-white font-bold dark:border-white/10 dark:bg-white/[0.04]">{!isPending && <RefreshCw className="h-3.5 w-3.5" />}{isPending ? getTranslation("manage.domains.refreshing") : getTranslation("manage.domains.verify")}</Button>
                    <Button type="button" variant="outline" size="sm" onClick={remove} disabled={isPending} className="h-9 rounded-xl border-rose-200 bg-white font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-400/20 dark:bg-white/[0.04] dark:text-rose-300"><Trash2 className="h-3.5 w-3.5" />{getTranslation("manage.domains.remove")}</Button>
                  </div>
                </div>

                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  <div className={`rounded-2xl border p-4 ${isLive ? "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-400/20 dark:bg-emerald-500/10" : status === "invalid" ? "border-orange-200/80 bg-orange-50/70 dark:border-orange-400/20 dark:bg-orange-500/10" : status === "failed" ? "border-rose-200/80 bg-rose-50/70 dark:border-rose-400/20 dark:bg-rose-500/10" : "border-amber-200/80 bg-amber-50/70 dark:border-amber-400/20 dark:bg-amber-500/10"}`}>
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300"><CheckCircle2 className="h-4 w-4" />{isLive ? getTranslation("manage.domains.connectionReady") : status === "invalid" ? getTranslation("manage.domains.connectionInvalid") : status === "failed" ? getTranslation("manage.domains.connectionFailed") : getTranslation("manage.domains.connectionPending")}</div>
                    <p className="mt-2 text-sm leading-5 text-slate-600 dark:text-slate-300">{isLive ? liveUrl : status === "invalid" ? getTranslation("manage.domains.messageInvalid") : status === "failed" ? getTranslation("manage.domains.messageCheckFailed") : getTranslation("manage.domains.addRecordHint")}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.035]"><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{getTranslation("manage.domains.lastChecked")}</p><p className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">{checkedAtLabel}</p>{instructions?.configuredBy && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{getTranslation("manage.domains.configuredBy")}: {instructions.configuredBy}</p>}</div>
                </div>

                <div className="mt-6"><ConnectionTimeline domain={domain} labels={{ domain: getTranslation("manage.domains.stepDomain"), domainDetail: getTranslation("manage.domains.stepDomainDetail"), dns: getTranslation("manage.domains.stepDns"), dnsDetail: getTranslation("manage.domains.stepDnsDetail"), live: getTranslation("manage.domains.stepLive"), liveDetail: getTranslation("manage.domains.stepLiveDetail") }} /></div>

                {primaryRecord && (
                  <div className="mt-6 rounded-2xl border border-violet-200/80 bg-violet-50/70 p-4 dark:border-violet-400/20 dark:bg-violet-500/10 sm:p-5">
                    <div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm"><Server className="h-4 w-4" /></div><div><h4 className="text-sm font-bold text-violet-950 dark:text-violet-100">{getTranslation("manage.domains.dnsTitle")}</h4><p className="mt-1 text-xs leading-5 text-violet-900/70 dark:text-violet-100/70">{getTranslation("manage.domains.dnsDescription")}</p></div></div>
                    <div className="mt-4 overflow-hidden rounded-xl border border-violet-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-[#171827]"><div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-3 dark:border-white/10"><span className="text-xs font-bold text-slate-700 dark:text-slate-200">{getTranslation("manage.domains.dnsRecord")}</span><span className="rounded-md bg-violet-100 px-2 py-1 font-mono text-[11px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">{primaryRecord.type}</span></div><div className="grid gap-px bg-slate-100 sm:grid-cols-4 dark:bg-white/10"><div className="min-w-0 bg-white p-3.5 dark:bg-[#171827]"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{getTranslation("manage.domains.recordHost")}</p><div className="mt-2 flex items-center justify-between gap-2"><code className="min-w-0 truncate text-xs font-bold text-slate-800 dark:text-slate-100">{primaryRecord.host}</code><CopyButton value={primaryRecord.host} id="dns-host" copied={copied} copyLabel={getTranslation("manage.domains.copy")} copiedLabel={getTranslation("manage.domains.copied")} onCopy={copyText} /></div></div><div className="min-w-0 bg-white p-3.5 dark:bg-[#171827]"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{getTranslation("manage.domains.recordType")}</p><p className="mt-2 text-xs font-bold text-slate-800 dark:text-slate-100">{primaryRecord.type}</p></div><div className="min-w-0 bg-white p-3.5 dark:bg-[#171827]"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{getTranslation("manage.domains.recordValue")}</p><div className="mt-2 flex items-center justify-between gap-2"><code className="min-w-0 truncate text-xs font-bold text-slate-800 dark:text-slate-100" title={primaryRecord.value}>{primaryRecord.value}</code><CopyButton value={primaryRecord.value} id="dns-value" copied={copied} copyLabel={getTranslation("manage.domains.copy")} copiedLabel={getTranslation("manage.domains.copied")} onCopy={copyText} /></div></div><div className="min-w-0 bg-white p-3.5 dark:bg-[#171827]"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{getTranslation("manage.domains.recordTtl")}</p><p className="mt-2 text-xs font-bold text-slate-800 dark:text-slate-100">{primaryRecord.ttl}</p></div></div></div>
                    {instructions?.misconfigured && <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200"><AlertCircle className="h-3.5 w-3.5" />{getTranslation("manage.domains.notDetected")}</p>}
                  </div>
                )}

                {domain && !primaryRecord && (
                  <div className="mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-bold">{getTranslation("manage.domains.dnsUnavailableTitle")}</p><p className="mt-1 text-xs leading-5 text-amber-900/75 dark:text-amber-100/75">{getTranslation("manage.domains.dnsUnavailableDescription")}</p></div></div>
                  </div>
                )}

                {additionalDnsRecords.length > 0 && (
                  <details className="group mt-4 rounded-2xl border border-slate-200/80 dark:border-white/10"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-slate-800 marker:hidden dark:text-slate-100"><span>{getTranslation("manage.domains.advancedRecords")}</span><span className="text-xs font-medium text-slate-400 transition group-open:rotate-180">⌄</span></summary><div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-white/10"><p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{getTranslation("manage.domains.advancedDescription")}</p><div className="space-y-2">{additionalDnsRecords.map((record) => <div key={record.id} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:bg-white/[0.04]"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{record.type} · {record.domain}</p><code className="mt-1 block break-all text-xs font-semibold text-slate-700 dark:text-slate-200">{record.value}</code></div><CopyButton value={record.value} id={record.id} copied={copied} copyLabel={getTranslation("manage.domains.copy")} copiedLabel={getTranslation("manage.domains.copied")} onCopy={copyText} /></div>)}</div></div></details>
                )}

                {domain.last_error_message && <p className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium leading-5 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{domain.last_error_message}</p>}
              </>
            )}
          </section>

          {domain && isLive && (
            <aside className="h-fit rounded-3xl border border-emerald-200/80 bg-emerald-50/70 p-5 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-500/10 sm:p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"><CheckCircle2 className="h-5 w-5" /></div>
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-200">{getTranslation("manage.domains.preferredUrl")}</p>
              <p className="mt-2 break-all text-lg font-bold tracking-tight text-emerald-950 dark:text-emerald-50">{liveUrl}</p>
              <div className="mt-5 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => copyText("preferred-url", liveUrl)} className="rounded-xl border-emerald-200 bg-white font-bold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-400/20 dark:bg-white/[0.06] dark:text-emerald-100"><ClipboardCheck className="h-3.5 w-3.5" />{copied === "preferred-url" ? getTranslation("manage.domains.copied") : getTranslation("manage.domains.copy")}</Button><Button asChild variant="outline" size="sm" className="rounded-xl border-emerald-200 bg-white font-bold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-400/20 dark:bg-white/[0.06] dark:text-emerald-100"><a href={liveUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />{getTranslation("manage.domains.openSite")}</a></Button></div>
              <div className="mt-6 border-t border-emerald-200/70 pt-4 text-xs leading-5 text-emerald-800/75 dark:border-emerald-400/20 dark:text-emerald-100/70"><div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-3.5 w-3.5" />{getTranslation("manage.domains.sslManaged")}</div></div>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
