"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowDownLeft, ArrowRight, CalendarClock, Check, CreditCard, ExternalLink, ReceiptText, ShieldCheck, Sparkles, X } from "lucide-react"
import { initializePaddle, type Paddle } from "@paddle/paddle-js"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { OrbLoader } from "@/components/ui/orb-loader"
import { BillingOverlayPortal } from "@/components/manage/billing-overlay-portal"
import { BillingSuccessExperience } from "@/components/manage/billing-success-experience"
import { PlanFeaturePreview } from "@/components/manage/plan-feature-preview"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import { formatDate as formatLocalizedDate, formatNumber } from "@/i18n/format"
import type { TranslationKey } from "@/i18n"
import type { PlanChangeEligibility } from "@sapienx/saas-core"
import {
  cancelPaddleSubscription,
  changePaddlePlan,
  createPaddlePortalSession,
  getBillingInvoiceUrl,
  getBillingTransactions,
  getPlanUsage,
  consumeBillingTransitionForCurrentUser,
  previewPaddleCheckout,
  previewPaddlePlanChange,
  reconcilePaddleSubscription,
  resumePaddleSubscription,
  startPaddleCheckout,
  startPaymentMethodRecovery,
} from "@/app/manage/plan/actions"

export type BillingPresentationConfig = {
  planOrder?: readonly string[]
  plans?: Readonly<Record<string, { label?: string; description?: string; highlights?: readonly string[] }>>
  copy?: Readonly<Record<string, string>>
  featureKeys?: readonly string[]
  limitKeys?: readonly string[]
  comparison?: readonly { key: string; label: string; kind?: "feature" | "limit"; featureKey?: string; limitKey?: string }[]
  comparisonRows?: readonly { key: string; label: string; kind?: "feature" | "limit"; featureKey?: string; limitKey?: string }[]
}

export type BillingUsageMetricConfig = { key: string; name: string; unit?: string }

export type ResolvedBillingPresentation = {
  planOrder: string[]
  supportedIntervals: Array<"month" | "year">
  defaultInterval: "month" | "year"
  comparisonRows: Array<{ key: string; label: string; kind: "feature" | "limit"; featureKey?: string; limitKey?: string }>
}

/** Resolve additive product presentation fields without assuming product keys. */
export function resolveBillingPresentation(
  plans: readonly Pick<Plan, "key">[],
  presentation?: BillingPresentationConfig,
  supportedIntervals: readonly string[] = ["month", "year"],
  defaultInterval = "month",
): ResolvedBillingPresentation {
  const planKeys = plans.map((plan) => plan.key)
  const requestedOrder = presentation?.planOrder || []
  const planOrder = requestedOrder.length === planKeys.length && requestedOrder.every((key) => planKeys.includes(key)) && new Set(requestedOrder).size === requestedOrder.length
    ? [...requestedOrder]
    : planKeys
  const intervals = supportedIntervals.filter((interval): interval is "month" | "year" => interval === "month" || interval === "year")
  const availableIntervals: Array<"month" | "year"> = intervals.length ? [...new Set(intervals)] : ["month"]
  const resolvedDefault = availableIntervals.includes(defaultInterval as "month" | "year") ? defaultInterval as "month" | "year" : availableIntervals[0]
  const configuredRows = [...(presentation?.comparison || []), ...(presentation?.comparisonRows || [])]
  const comparisonRows: ResolvedBillingPresentation["comparisonRows"] = configuredRows.length
    ? configuredRows.map((row) => ({ ...row, kind: (row.kind || (row.limitKey ? "limit" : "feature")) as "feature" | "limit" }))
    : [
        ...(presentation?.featureKeys || []).map((key) => ({ key: `feature.${key}`, label: key, kind: "feature" as const, featureKey: key })),
        ...(presentation?.limitKeys || []).map((key) => ({ key: `limit.${key}`, label: key, kind: "limit" as const, limitKey: key })),
      ]
  return { planOrder, supportedIntervals: availableIntervals, defaultInterval: resolvedDefault, comparisonRows }
}

type Plan = {
  key: string
  name: string
  sort_order: number
  active: boolean
  limits: Record<string, number | null>
  metadata: Record<string, unknown>
  features: Record<string, boolean>
}

type BillingState = {
  canManage: boolean
  paddleConfigured: boolean
  environment: string | null
  provider: string | null
  customerId: string | null
  subscriptionId: string | null
  providerStatus: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  nextBilledAt: string | null
  cancelAtPeriodEnd: boolean
  scheduledChangeAt: string | null
  scheduledChangeAction: string | null
  billingIssueCode: string | null
  billingInterval: string | null
  billingCurrency: string | null
  scheduledPlanKey: string | null
  scheduledPlanAt: string | null
  scheduledPlanInterval: string | null
  currentProviderPriceAmount: string | null
  paymentFailureStartedAt: string | null
  paymentGraceEndsAt: string | null
  paymentMethod: { type: string; last4: string | null; expiryMonth: number | null; expiryYear: number | null } | null
}

type ConfiguredPrice = { planKey: string; interval: string; currency: string; providerPriceId: string; amount: string | null }

type Props = {
  currentPlan: string
  billing: BillingState
  plans: Plan[]
  configuredPaidPlans: string[]
  configuredPrices: ConfiguredPrice[]
  presentation?: BillingPresentationConfig
  usageMetrics?: BillingUsageMetricConfig[]
  supportedIntervals?: readonly string[]
  defaultInterval?: string
}

const GENERIC_PLAN_COPY: {
  positioning: TranslationKey
  description: TranslationKey
  highlights: TranslationKey[]
} = {
  positioning: "manage.planUsage.billing.moreRoomToGrow",
  description: "manage.planUsage.billing.moreCapacity",
  highlights: ["manage.planUsage.billing.moreUsageHeadroom", "manage.planUsage.billing.moreTeamControl"],
}

type PlanChangePreview = {
  plan: string
  interval: string
  isDowngrade: boolean
  prorationBillingMode: string
  action: string | null
  amount: string | null
  currency: string | null
  recurringAmount: string | null
  recurringCurrency: string | null
  creditToBalance: string | null
  nextBilledAt: string | null
  effectiveAt: string | null
  previewToken: string
}

type CheckoutPreview = { planKey: string; plan: string; interval: string; amount: string; currency: string; nextRecurringAmount: string }

type BillingConfirmation =
  | { type: "checkout"; planKey: string; preview: CheckoutPreview }
  | { type: "plan-change"; planKey: string; preview: PlanChangePreview }
  | { type: "cancel"; reason: string; feedback: string }

type PendingBillingOutcome = {
  kind: "purchase" | "upgrade" | "downgrade" | "billing"
  targetPlanKey: string
  targetInterval: string
  transitionId?: string | null
  effectiveAt?: string | null
  fromPlanName?: string | null
}

type BillingSuccessState = PendingBillingOutcome & {
  planName: string
  highlights: string[]
}

type BillingAction =
  | "manage-billing"
  | "payment-method"
  | "recover-payment"
  | "reactivate-banner"
  | "reactivate-details"
  | "view-invoices"
  | "refresh-invoices"
  | "confirm-billing"
  | `checkout-preview:${string}`
  | `plan-preview:${string}`
  | `invoice:${string}`

export function PaddleBillingActions({ currentPlan, billing, plans, configuredPaidPlans, configuredPrices, presentation, usageMetrics = [], supportedIntervals = ["month", "year"], defaultInterval = "month" }: Props) {
  const { currentLang, getTranslation, translateMessage } = useLanguage()
  const { updateCurrentWorkspacePlan } = useManageContext()
  const t = getTranslation
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [paddle, setPaddle] = useState<Paddle | null>(null)
  const paddleRef = useRef<Paddle | null>(null)
  const checkoutCompletedRef = useRef(false)
  const checkoutOutcomeRef = useRef<PendingBillingOutcome | null>(null)
  const [activating, setActivating] = useState(false)
  const [activeAction, setActiveAction] = useState<BillingAction | null>(null)
  const [pendingOutcome, setPendingOutcome] = useState<PendingBillingOutcome | null>(null)
  const [successExperience, setSuccessExperience] = useState<BillingSuccessState | null>(null)
  const [selectingPlan, setSelectingPlan] = useState<string | null>(null)
  const [billingConfirmation, setBillingConfirmation] = useState<BillingConfirmation | null>(null)
  const [blockedPlanChange, setBlockedPlanChange] = useState<{ targetPlan: string; eligibility: PlanChangeEligibility } | null>(null)
  const [billingInterval, setBillingInterval] = useState(billing.billingInterval === "year" ? "year" : defaultInterval === "year" ? "year" : "month")
  const [cancellationReason, setCancellationReason] = useState("too_expensive")
  const [cancellationFeedback, setCancellationFeedback] = useState("")
  const [history, setHistory] = useState<Array<Record<string, string | null>> | null>(null)

  const resolvedPresentation = useMemo(
    () => resolveBillingPresentation(plans, presentation, supportedIntervals, defaultInterval),
    [defaultInterval, plans, presentation, supportedIntervals],
  )
  const presentationCopy = presentation?.copy || {}
  const copyText = (key: string, fallback: string) => presentationCopy[key]?.trim() || fallback
  const planPresentation = useCallback((plan: Plan) => presentation?.plans?.[plan.key] || {}, [presentation])
  const planCopy = useCallback((plan: Plan) => {
    const configured = planPresentation(plan)
    const configuredHighlights = configured.highlights?.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()) || []
    return {
      label: configured.label?.trim() || plan.name,
      description: configured.description?.trim() || t("manage.planUsage.billing.catalogDescription"),
      highlights: configuredHighlights.length ? configuredHighlights : [t(GENERIC_PLAN_COPY.highlights[0]), t(GENERIC_PLAN_COPY.highlights[1])],
    }
  }, [planPresentation, t])
  const displayKey = (key: string) => presentationCopy[key] || presentationCopy[`feature.${key}`] || presentationCopy[`limit.${key}`] || key.replaceAll(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
  const usageMetricName = (key: string) => usageMetrics.find((metric) => metric.key === key)?.name || displayKey(key)
  const eligibilityCapabilityName = (key: string) => key === "core.workspaces"
    ? copyText("workspacesLabel", t("manage.planUsage.billing.workspaces"))
    : key === "core.members"
    ? copyText("teamMembersLabel", t("manage.planUsage.billing.teamMembers"))
    : usageMetricName(key)
  const eligibilityViolationText = (violation: PlanChangeEligibility["violations"][number]) => {
    const label = eligibilityCapabilityName(violation.capability)
    if (violation.reason === "LIMIT_EXCEEDED" && typeof violation.current === "number" && typeof violation.targetLimit === "number") {
      const excess = typeof violation.excess === "number" ? violation.excess : Math.max(0, violation.current - violation.targetLimit)
      return `${label}: ${violation.current.toLocaleString()} used / ${violation.targetLimit.toLocaleString()} allowed. Reduce usage by ${excess.toLocaleString()} before switching.`
    }
    if (violation.reason === "USAGE_UNAVAILABLE") return `${label}: current usage could not be verified. Try again before switching.`
    if (violation.reason === "CAPABILITY_NOT_CONFIGURED") return `${label}: this capability is not configured on the target plan.`
    return "The selected plan is not available."
  }
  const planLimitKeys = (plan: Plan) => {
    const requested = presentation?.limitKeys?.length ? presentation.limitKeys : Object.keys(plan.limits)
    return [...new Set(requested)].filter((key) => Object.prototype.hasOwnProperty.call(plan.limits, key))
  }
  const planLimitValue = (plan: Plan, key: string) => {
    const value = plan.limits[key]
    return value === null ? "Unlimited" : value === undefined ? "—" : value.toLocaleString()
  }

  const orderedPlans = useMemo(() => {
    const order = new Map(resolvedPresentation.planOrder.map((key, index) => [key, index]))
    return [...plans].sort((a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER) || a.sort_order - b.sort_order || a.key.localeCompare(b.key))
  }, [plans, resolvedPresentation.planOrder])

  useEffect(() => {
    if (!pendingOutcome) return
    let cancelled = false
    let attempts = 0

    const refreshUntilVerified = async () => {
      if (attempts === 0 || attempts % 3 === 0) {
        await reconcilePaddleSubscription()
        if (cancelled) return
      }
      const result = await getPlanUsage()
      if (cancelled) return
      const data = result.success ? result.data : null
      const providerStatus = data?.billing.providerStatus
      const subscriptionIsActive = providerStatus === "active" || providerStatus === "trialing"
      const isScheduledDowngrade = pendingOutcome.kind === "downgrade"
      const planIsVerified = isScheduledDowngrade
        ? data?.billing.scheduledPlanKey === pendingOutcome.targetPlanKey
        : data?.entitlements.planKey === pendingOutcome.targetPlanKey
      const intervalIsVerified = isScheduledDowngrade
        ? data?.billing.scheduledPlanInterval === pendingOutcome.targetInterval
        : data?.billing.billingInterval === pendingOutcome.targetInterval
      if (data && planIsVerified && intervalIsVerified && subscriptionIsActive) {
        if (!pendingOutcome.transitionId) {
          setActivating(false)
          setPendingOutcome(null)
          setMessage(t("manage.planUsage.billing.paymentReceived"))
          return
        }
        const consumption = await consumeBillingTransitionForCurrentUser(pendingOutcome.transitionId)
        if (cancelled) return
        if (!consumption.success || !consumption.data || consumption.data.state !== "succeeded") {
          attempts += 1
          if (attempts < 12) {
            window.setTimeout(refreshUntilVerified, 2500)
            return
          }
          setActivating(false)
          setPendingOutcome(null)
          setMessage(translateMessage(consumption.message || t("manage.planUsage.billing.paymentReceived")))
          return
        }
        // Only the tab that atomically inserted the consumption gets to show
        // the celebration. A duplicate tab/reload still refreshes quietly.
        if (!consumption.data.consumed) {
          setActivating(false)
          setPendingOutcome(null)
          router.refresh()
          return
        }
        const plan = data.plans.find((entry) => entry.key === pendingOutcome.targetPlanKey)
        updateCurrentWorkspacePlan({
          key: data.entitlements.planKey,
          name: data.entitlements.planName,
          pricing: data.entitlements.pricing,
          limits: { ...data.entitlements.limits },
          scheduledPlan: data.entitlements.scheduledPlan
            ? {
                key: data.entitlements.scheduledPlan.key,
                name: data.entitlements.scheduledPlan.name,
                effectiveAt: data.entitlements.scheduledPlan.effectiveAt,
                limits: { ...data.entitlements.scheduledPlan.limits },
              }
            : null,
        })
        setActivating(false)
        setPendingOutcome(null)
        setSuccessExperience({
          ...pendingOutcome,
          planName: plan ? planCopy(plan).label : pendingOutcome.targetPlanKey,
          highlights: plan ? planCopy(plan).highlights : [t(GENERIC_PLAN_COPY.highlights[0]), t(GENERIC_PLAN_COPY.highlights[1])],
          effectiveAt: isScheduledDowngrade ? data?.billing.scheduledPlanAt || pendingOutcome.effectiveAt : null,
        })
        router.refresh()
        return
      }
      attempts += 1
      if (attempts < 12) window.setTimeout(refreshUntilVerified, 2500)
      else {
        setActivating(false)
        setPendingOutcome(null)
        setMessage(t("manage.planUsage.billing.paymentReceived"))
      }
    }

    setActivating(true)
    void refreshUntilVerified()
    return () => {
      cancelled = true
    }
  }, [pendingOutcome, planCopy, router, t, translateMessage, updateCurrentWorkspacePlan])

  useEffect(() => {
    const requestedInterval = searchParams.get("interval")
    if (resolvedPresentation.supportedIntervals.includes(requestedInterval as "month" | "year")) setBillingInterval(requestedInterval as "month" | "year")
  }, [resolvedPresentation.supportedIntervals, searchParams])

  useEffect(() => {
    if (!pending && activeAction) setActiveAction(null)
  }, [activeAction, pending])

  const beginAction = (action: BillingAction, task: () => Promise<void>) => {
    setActiveAction(action)
    startTransition(async () => {
      await task()
    })
  }

  const run = (action: BillingAction, operation: () => Promise<{ success: boolean; message?: string; data?: unknown; url?: string }>, outcome?: PendingBillingOutcome) => {
    beginAction(action, async () => {
      setMessage(null)
      const result = await operation()
      const data = result.data && typeof result.data === "object" ? result.data as { transactionId?: unknown; transitionId?: unknown; token?: unknown; environment?: unknown; url?: unknown } : null
      if (!result.success) {
        const eligibilityData = result.data && typeof result.data === "object" ? result.data as { targetPlan?: unknown; eligibility?: unknown } : null
        if (typeof eligibilityData?.targetPlan === "string" && eligibilityData.eligibility && typeof eligibilityData.eligibility === "object") {
          const eligibility = eligibilityData.eligibility as PlanChangeEligibility
          if (eligibility.allowed === false && Array.isArray(eligibility.violations)) setBlockedPlanChange({ targetPlan: eligibilityData.targetPlan, eligibility })
        }
        setMessage(translateMessage(result.message || t("manage.planUsage.billing.actionFailed")))
        return
      }
      if (typeof result.url === "string") {
        window.location.assign(result.url)
        return
      }
      if (!data) {
        setMessage(translateMessage(result.message || t("manage.planUsage.billing.actionCompleted")))
        if (outcome) setPendingOutcome(outcome)
        router.refresh()
        return
      }
      if (typeof data.url === "string") {
        window.location.assign(data.url)
        return
      }
      if (typeof data.transactionId === "string" && typeof data.token === "string" && (data.environment === "sandbox" || data.environment === "production")) {
        const instance = paddle || await initializePaddle({
          token: data.token,
          environment: data.environment,
          eventCallback: (event) => {
            if (event.name === "checkout.completed") {
              checkoutCompletedRef.current = true
              setMessage(null)
              setActivating(true)
              if (checkoutOutcomeRef.current) setPendingOutcome(checkoutOutcomeRef.current)
              else {
                setActivating(false)
                setMessage(t("manage.planUsage.billing.actionCompleted"))
                router.refresh()
              }
              try {
                paddleRef.current?.Checkout.close()
              } catch {
                // Keep server-side verification running if Paddle has already closed itself.
              }
            }
            if (event.name === "checkout.closed" && !checkoutCompletedRef.current) {
              setMessage(t("manage.planUsage.billing.checkoutClosed"))
            }
          },
        })
        if (!instance) {
          setMessage(t("manage.planUsage.billing.checkoutInitFailed"))
          return
        }
        checkoutCompletedRef.current = false
        checkoutOutcomeRef.current = outcome
          ? { ...outcome, transitionId: typeof data.transitionId === "string" ? data.transitionId : null }
          : null
        paddleRef.current = instance
        setPaddle(instance)
        instance.Checkout.open({ transactionId: data.transactionId })
        setMessage(t("manage.planUsage.billing.completeCheckout"))
        return
      }
      if (outcome) {
        const transitionId = typeof data.transitionId === "string" ? data.transitionId : null
        setPendingOutcome({ ...outcome, transitionId })
        router.refresh()
        return
      }
      setMessage(translateMessage(result.message || t("manage.planUsage.billing.actionCompleted")))
      router.refresh()
    })
  }

  const startCheckout = (planKey: string) => {
    setBlockedPlanChange(null)
    beginAction(`checkout-preview:${planKey}`, async () => {
      setMessage(null)
      const preview = await previewPaddleCheckout(planKey, billingInterval)
      if (!preview.success || !preview.data) {
        setMessage(translateMessage(preview.message || t("manage.planUsage.billing.actionFailed")))
        return
      }
      setBillingConfirmation({ type: "checkout", planKey, preview: preview.data })
    })
  }

  const changePlan = (planKey: string) => {
    setMessage(null)
    setBlockedPlanChange(null)
    beginAction(`plan-preview:${planKey}`, async () => {
      const preview = await previewPaddlePlanChange(planKey, billingInterval)
      if (!preview.success || !preview.data) {
        const eligibilityData = preview.data && typeof preview.data === "object" ? preview.data as { targetPlan?: unknown; eligibility?: unknown } : null
        if (typeof eligibilityData?.targetPlan === "string" && eligibilityData.eligibility && typeof eligibilityData.eligibility === "object") {
          const eligibility = eligibilityData.eligibility as PlanChangeEligibility
          if (eligibility.allowed === false && Array.isArray(eligibility.violations)) setBlockedPlanChange({ targetPlan: eligibilityData.targetPlan, eligibility })
        }
        setMessage(translateMessage(preview.message || t("manage.planUsage.billing.actionFailed")))
        return
      }

      setBillingConfirmation({ type: "plan-change", planKey, preview: preview.data })
    })
  }

  const manageBilling = () => run("manage-billing", () => createPaddlePortalSession())

  const cancelSubscription = () => setBillingConfirmation({ type: "cancel", reason: cancellationReason, feedback: cancellationFeedback })

  // The effective local plan is authoritative for UI state. A provider row
  // can remain present after cancellation, pause, or grace expiry.
  const isPaid = configuredPaidPlans.includes(currentPlan) && billing.providerStatus !== "canceled" && billing.providerStatus !== "paused"
  const currentPlanRecord = plans.find((plan) => plan.key === currentPlan)
  const currentPlanName = currentPlanRecord ? planCopy(currentPlanRecord).label : t("manage.planUsage.activePlan")
  const selectedPlanKey = searchParams.get("plan") || (isPaid ? currentPlan : null)
  const dateLabel = (value: string | null) => value ? formatLocalizedDate(value, currentLang, { dateStyle: "medium" }) : null
  const configuredMoney = (price: ConfiguredPrice | undefined) => {
    if (!price?.amount) return "Price unavailable"
    const numericAmount = Number(price.amount)
    if (!Number.isFinite(numericAmount)) return "Price unavailable"
    const fractionDigits = new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).resolvedOptions().maximumFractionDigits ?? 2
    return formatNumber(numericAmount / (10 ** fractionDigits), currentLang, { style: "currency", currency: price.currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  const configuredMoneyFromMinorUnits = (amount: number, currency: string) => {
    const fractionDigits = new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
    return formatNumber(amount / (10 ** fractionDigits), currentLang, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  const configuredPriceFor = (planKey: string) => configuredPrices.find((price) => price.planKey === planKey && price.interval === billingInterval)
  const annualSavings = (planKey: string) => {
    const monthly = configuredPrices.find((price) => price.planKey === planKey && price.interval === "month")
    const annual = configuredPrices.find((price) => price.planKey === planKey && price.interval === "year")
    if (!monthly?.amount || !annual?.amount || monthly.currency !== annual.currency) return null
    const monthlyAmount = Number(monthly.amount)
    const annualAmount = Number(annual.amount)
    if (!Number.isFinite(monthlyAmount) || !Number.isFinite(annualAmount) || monthlyAmount <= 0) return null
    const savedAmount = monthlyAmount * 12 - annualAmount
    if (savedAmount <= 0) return null
    return {
      amount: configuredMoneyFromMinorUnits(savedAmount, annual.currency),
      regularAnnualAmount: configuredMoneyFromMinorUnits(monthlyAmount * 12, monthly.currency),
      percent: Math.round((savedAmount / (monthlyAmount * 12)) * 100),
      currency: annual.currency,
    }
  }
  const renderBillingIntervalSwitch = (className = "") => (
    <div className={`inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-white/10 dark:bg-white/[0.06] ${className}`} role="group" aria-label={t("manage.planUsage.billing.billingCycle")}>
      {resolvedPresentation.supportedIntervals.map((interval) => {
        const available = configuredPrices.some((price) => price.interval === interval)
        const active = billingInterval === interval
        return (
          <button
            key={interval}
            type="button"
            disabled={!available}
            aria-pressed={active}
            onClick={(event) => {
              event.stopPropagation()
              setBillingInterval(interval)
            }}
            className={`min-h-7 rounded-md px-2 py-1 text-[10px] font-bold transition ${active ? "bg-violet-600 text-white shadow-sm" : "text-slate-600 hover:bg-white dark:text-slate-200 dark:hover:bg-white/10"} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {interval === "month" ? t("manage.planUsage.billing.monthly") : t("manage.planUsage.billing.annual")}
          </button>
        )
      })}
    </div>
  )
  const formatPaddleAmount = (amount: string | null, currency: string | null) => {
    if (!amount || !currency) return null
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount)) return null

    try {
      const fractionDigits = new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
      return formatNumber(numericAmount / (10 ** fractionDigits), currentLang, {
        style: "currency",
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      })
    } catch {
      return null
    }
  }

  const comparisonValue = (plan: Plan, row: ResolvedBillingPresentation["comparisonRows"][number]) => {
    if (row.kind === "feature") {
      const value = row.featureKey ? plan.features[row.featureKey] : undefined
      return value === undefined ? "—" : value ? "✓" : "×"
    }
    const value = row.limitKey ? plan.limits[row.limitKey] : undefined
    return value === null ? "∞" : value === undefined ? "—" : value.toLocaleString()
  }

  const planChangeConfirmation = billingConfirmation?.type === "plan-change" ? billingConfirmation : null
  const checkoutConfirmation = billingConfirmation?.type === "checkout" ? billingConfirmation : null
  const previewIsDowngrade = Boolean(planChangeConfirmation?.preview.isDowngrade)
  const previewAmount = planChangeConfirmation?.preview.action === "charge"
    ? formatPaddleAmount(planChangeConfirmation.preview.amount, planChangeConfirmation.preview.currency)
    : null
  const previewIsCredit = !previewIsDowngrade && planChangeConfirmation?.preview.action === "credit"
  const previewCreditToBalance = planChangeConfirmation?.preview.creditToBalance && !/^0+$/.test(planChangeConfirmation.preview.creditToBalance)
    ? formatPaddleAmount(planChangeConfirmation.preview.creditToBalance, planChangeConfirmation.preview.currency)
    : null
  const previewActionLabel = previewIsDowngrade
    ? t("manage.planUsage.billing.changePlanDowngradeNoRefund")
    : planChangeConfirmation?.preview.action === "credit"
    ? t("manage.planUsage.billing.changePlanCredit")
    : planChangeConfirmation?.preview.action === "charge"
      ? t("manage.planUsage.billing.changePlanCharge")
      : t("manage.planUsage.billing.changePlanNoCharge")
  const previewTimingLabel = previewIsDowngrade
    ? t("manage.planUsage.billing.changePlanDowngradeTiming")
    : planChangeConfirmation?.preview.prorationBillingMode === "prorated_immediately"
    ? t("manage.planUsage.billing.changePlanProrationImmediate")
    : t("manage.planUsage.billing.changePlanProrationNext")

  const confirmBillingAction = () => {
    const confirmation = billingConfirmation
    setBillingConfirmation(null)
    if (!confirmation) return
    if (confirmation.type === "checkout") {
      run(
        "confirm-billing",
        () => startPaddleCheckout(confirmation.planKey, billingInterval, `${confirmation.planKey}-${crypto.randomUUID()}`),
        { kind: "purchase", targetPlanKey: confirmation.planKey, targetInterval: billingInterval },
      )
      return
    }
    if (confirmation.type === "plan-change") {
      const outcome = {
        kind: confirmation.preview.isDowngrade
          ? "downgrade" as const
          : confirmation.planKey === currentPlan ? "billing" as const : "upgrade" as const,
        targetPlanKey: confirmation.planKey,
        targetInterval: billingInterval,
        effectiveAt: confirmation.preview.effectiveAt,
        fromPlanName: currentPlanName,
      }
      run("confirm-billing", () => changePaddlePlan(confirmation.planKey, confirmation.preview.previewToken, `plan-${crypto.randomUUID()}`, billingInterval), outcome)
      return
    }
    run("confirm-billing", () => cancelPaddleSubscription(confirmation.reason, confirmation.feedback, `cancel-${crypto.randomUUID()}`))
  }

  const loadHistory = (action: "view-invoices" | "refresh-invoices") => {
    beginAction(action, async () => {
      const result = await getBillingTransactions()
      if (result.success) setHistory(result.data || [])
      else setMessage(translateMessage(result.message || t("manage.planUsage.billing.actionFailed")))
    })
  }

  const openPaymentMethod = () => run("payment-method", () => createPaddlePortalSession("payment_method"))
  const recoverPayment = () => run("recover-payment", () => startPaymentMethodRecovery())
  const reactivate = (action: "reactivate-banner" | "reactivate-details") => run(action, () => resumePaddleSubscription(`resume-${crypto.randomUUID()}`))

  const selectPlan = (planKey: string) => {
    if (selectedPlanKey === planKey) return
    setBlockedPlanChange(null)
    setSelectingPlan(planKey)
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set("plan", planKey)
    router.replace(`/manage/plan?${nextParams.toString()}`, { scroll: false })
    window.setTimeout(() => {
      document.getElementById("plan-preview")?.scrollIntoView({ behavior: "smooth", block: "start" })
      setSelectingPlan(null)
    }, 220)
  }

  const currentPlanDetails = plans.find((plan) => plan.key === currentPlan)
  const selectedPlan = plans.find((plan) => plan.key === selectedPlanKey) || currentPlanDetails || null
  const currentPlanSortOrder = currentPlanDetails?.sort_order || 0
  const currentPlanPresentationOrder = resolvedPresentation.planOrder.indexOf(currentPlan)
  const availablePlans = orderedPlans.filter((plan) => !isPaid || plan.key !== currentPlan)
  const paymentMethodLabel = billing.paymentMethod
    ? `${billing.paymentMethod.type}${billing.paymentMethod.last4 ? ` ending in ${billing.paymentMethod.last4}` : ""}`
    : t("manage.planUsage.billing.securePaymentDetails")

  if (successExperience) {
    return (
      <BillingSuccessExperience
        kind={successExperience.kind}
        planName={successExperience.planName}
        interval={successExperience.targetInterval}
        highlights={successExperience.highlights}
        effectiveAt={successExperience.effectiveAt}
        fromPlanName={successExperience.fromPlanName}
        onClose={() => setSuccessExperience(null)}
        onContinue={() => {
          setSuccessExperience(null)
          router.push("/manage")
        }}
        onManageBilling={manageBilling}
      />
    )
  }

  return (
    <div id="plan-options" className="space-y-5">
      {(billing.cancelAtPeriodEnd || billing.billingIssueCode === "past_due" || billing.billingIssueCode === "grace_expired") && (
        <section className="space-y-3" aria-label={t("manage.planUsage.billing.subscription") }>
          {billing.cancelAtPeriodEnd && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100"><div><p>{t("manage.planUsage.billing.cancellationScheduled", { date: dateLabel(billing.scheduledChangeAt || billing.currentPeriodEnd) ? t("manage.planUsage.billing.cancellationDate", { date: dateLabel(billing.scheduledChangeAt || billing.currentPeriodEnd) || "" }) : t("manage.planUsage.billing.cancellationEnd") })}</p><p className="mt-1 text-xs font-normal text-amber-800/75 dark:text-amber-200/75">{t("manage.planUsage.billing.cancelDialogDescription")}</p></div>{billing.canManage && <Button type="button" onClick={() => reactivate("reactivate-banner")} loading={activeAction === "reactivate-banner"} className="min-h-9 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-300/30 dark:bg-white/10 dark:text-amber-100">{t("manage.planUsage.billing.reactivateSubscription")}</Button>}</div>}
          {billing.billingIssueCode === "past_due" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100"><div><p className="font-semibold">{t("manage.planUsage.billing.paymentCouldNot")}</p><p className="mt-1 text-xs font-normal text-amber-800/75 dark:text-amber-200/75">{t("manage.planUsage.billing.paymentGraceDescription", { date: dateLabel(billing.paymentGraceEndsAt) || "—" })}</p></div>{billing.canManage && <Button type="button" onClick={recoverPayment} loading={activeAction === "recover-payment"} className="min-h-9 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800">{t("manage.planUsage.billing.updatePaymentMethod")}</Button>}</div>}
          {billing.billingIssueCode === "grace_expired" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100"><div><p className="font-semibold">{t("manage.planUsage.billing.paymentGraceExpired")}</p><p className="mt-1 text-xs font-normal text-rose-800/75 dark:text-rose-200/75">{t("manage.planUsage.billing.paymentGraceExpiredDescription")}</p></div>{billing.canManage && <Button type="button" onClick={recoverPayment} loading={activeAction === "recover-payment"} className="min-h-9 rounded-lg bg-rose-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-800">{t("manage.planUsage.billing.updatePaymentMethod")}</Button>}</div>}
        </section>
      )}

      {blockedPlanChange && <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100" role="alert" data-plan-change-eligibility={blockedPlanChange.targetPlan}>
        <p className="font-semibold">This downgrade is not available for the target plan.</p>
        <p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-200/80">Existing resources remain intact. Reduce the listed usage or choose another plan before scheduling the change.</p>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900 dark:text-amber-100">{blockedPlanChange.eligibility.violations.map((violation, index) => <li key={`${violation.capability}-${violation.reason}-${index}`}>{eligibilityViolationText(violation)}</li>)}</ul>
      </section>}

      <section id="upgrade-plans" className="manage-plan-card scroll-mt-6 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5" /> {isPaid ? t("manage.planUsage.billing.changePlan") : t("manage.planUsage.billing.readyWhenYouAre")}</p>
          <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950 dark:text-white">{t(isPaid ? "manage.planUsage.billing.changePlanSection" : "manage.planUsage.billing.upgradeSection")}</h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-300">{isPaid ? t("manage.planUsage.billing.paidDescription") : t("manage.planUsage.billing.baseDescription")}</p>
          </div>
          {(availablePlans.length > 0 || isPaid) && <div className="flex items-center gap-2"><span className="hidden text-xs font-semibold text-slate-500 dark:text-slate-400 sm:inline">{t("manage.planUsage.billing.billingCycle")}</span>{renderBillingIntervalSwitch()}</div>}
        </div>

        {billing.canManage && availablePlans.length > 0 && (
          <>
            {!isPaid && <div className="manage-plan-offer-banner mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-violet-50 px-4 py-3 dark:bg-violet-500/10"><div><p className="text-sm font-semibold text-violet-950 dark:text-violet-100">{t("manage.planUsage.billing.startWithPlan")}</p><p className="mt-0.5 text-xs text-violet-800/75 dark:text-violet-200/75">{t("manage.planUsage.billing.noLongSetup")}</p></div><span className="flex items-center gap-1 text-xs font-semibold text-violet-700 dark:text-violet-200"><ShieldCheck className="h-3.5 w-3.5" /> {t("manage.planUsage.billing.secureCheckout")}</span></div>}
            <div className={`mt-4 grid gap-4 ${availablePlans.length === 1 ? "max-w-2xl" : availablePlans.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
              {availablePlans.map((plan) => {
                const configured = configuredPrices.some((price) => price.planKey === plan.key && price.interval === billingInterval) && configuredPaidPlans.includes(plan.key)
                const recommended = Boolean(plan.metadata.recommended)
                const isDowngrade = isPaid && (currentPlanPresentationOrder >= 0 ? resolvedPresentation.planOrder.indexOf(plan.key) < currentPlanPresentationOrder : plan.sort_order < currentPlanSortOrder)
                const copy = planCopy(plan)
                const selected = selectedPlanKey === plan.key
                const selecting = selectingPlan === plan.key
                const savings = annualSavings(plan.key)
                return (
                  <article
                    key={plan.key}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={t("manage.planUsage.includedIn", { plan: copy.label })}
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return
                      selectPlan(plan.key)
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
                      event.preventDefault()
                      selectPlan(plan.key)
                    }}
                    className={`manage-plan-offer relative flex h-full cursor-pointer flex-col rounded-2xl border p-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#22232e] ${selected ? "manage-plan-offer-selected" : ""} ${recommended ? "manage-plan-offer-recommended border-violet-300" : "border-slate-200 dark:border-white/10"}`}
                  >
                    {recommended && <span className="absolute right-4 top-4 rounded-full bg-violet-600 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white">{t("manage.planUsage.billing.mostPopular")}</span>}
                    <div className="flex items-start justify-between gap-3 pr-20">
                      <div className="text-left"><p className="text-lg font-bold text-slate-950 dark:text-white">{copy.label}</p><p className="mt-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">{copyText("planPositioning", t(GENERIC_PLAN_COPY.positioning))}</p></div>
                      {selected && <span className="shrink-0 rounded-full bg-violet-100 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">{t("manage.planUsage.billing.selected")}</span>}
                    </div>
                    <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <div className="flex items-baseline gap-1.5"><p className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{configuredMoney(configuredPriceFor(plan.key))}</p><span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{billingInterval === "year" ? t("manage.planUsage.billing.perYear") : t("manage.planUsage.billing.perMonth")}</span></div>
                        {billingInterval === "year" && savings && <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"><span className="font-semibold text-slate-400 line-through dark:text-slate-500">{savings.regularAnnualAmount} {t("manage.planUsage.billing.perYear")}</span><span className="font-bold text-emerald-700 dark:text-emerald-300">{t("manage.planUsage.billing.annualSavings", { amount: savings.amount, percent: String(savings.percent) })}</span></div>}
                        <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{billingInterval === "year" ? t("manage.planUsage.billing.billedAnnually") : t("manage.planUsage.billing.billedMonthly")}</p>
                      </div>
                      {billingInterval === "year" && savings && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{t("manage.planUsage.billing.savePercent", { percent: String(savings.percent) })}</span>}
                    </div>
                    <p className="mt-2 min-h-10 text-xs leading-5 text-slate-600 dark:text-slate-300">{copy.description}</p>
                    {planLimitKeys(plan).length > 0 && <div className={`mt-4 grid gap-2 border-y border-slate-100 py-3 dark:border-white/10 ${planLimitKeys(plan).length > 2 ? "sm:grid-cols-3" : planLimitKeys(plan).length === 2 ? "sm:grid-cols-2" : "grid-cols-1"}`}>{planLimitKeys(plan).map((key) => <div key={key} className="min-w-0"><p className="truncate text-lg font-bold leading-none tabular-nums text-slate-950 dark:text-white">{planLimitValue(plan, key)}</p><p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">{key === "core.workspaces" ? copyText("workspacesLabel", t("manage.planUsage.billing.workspaces")) : key === "core.members" ? copyText("teamMembersLabel", t("manage.planUsage.billing.teamMembers")) : usageMetricName(key)}</p></div>)}</div>}
                    <ul className="mt-4 space-y-2 text-xs text-slate-700 dark:text-slate-200">{copy.highlights.map((highlight) => <li key={highlight} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />{highlight}</li>)}</ul>
                    <Button type="button" onClick={() => isPaid ? changePlan(plan.key) : startCheckout(plan.key)} loading={activeAction === (isPaid ? `plan-preview:${plan.key}` : `checkout-preview:${plan.key}`)} disabled={!billing.paddleConfigured || !configured} className={`mt-5 min-h-11 w-full rounded-xl px-3 py-2 text-sm font-semibold transition ${recommended && !isDowngrade ? "bg-violet-600 text-white hover:bg-violet-700" : "border border-slate-200 bg-transparent text-slate-800 hover:bg-slate-50 dark:border-white/10 dark:text-white dark:hover:bg-white/10"}`}>{configured && billing.paddleConfigured ? <><span>{isPaid ? t(isDowngrade ? "manage.planUsage.billing.moveTo" : "manage.planUsage.billing.upgradeTo", { plan: copy.label }) : t("manage.planUsage.billing.choose", { plan: copy.label })}</span><ArrowRight className="ml-1 h-3.5 w-3.5" /></> : t("manage.planUsage.billing.billingSetupRequired")}</Button>
                    {selecting && <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/80 text-[10px] font-semibold text-violet-700 backdrop-blur-[2px] dark:bg-[#22232e]/85 dark:text-violet-200" role="status"><OrbLoader label={t("manage.planUsage.billing.loadingPreview", { plan: plan.name })} state="working" size="sm" showLabel={false} /><span>{t("manage.planUsage.billing.updatingPreview")}</span></div>}
                  </article>
                )
              })}
            </div>
          </>
        )}
        {billing.canManage && isPaid && availablePlans.length === 0 && <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">{t("manage.planUsage.billing.highestPlan")}</p>}
        {!billing.canManage && <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">{t("manage.planUsage.billing.ownerOnly")}</p>}
        {!billing.paddleConfigured && billing.canManage && !isPaid && <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{t("manage.planUsage.billing.paddleNotConfigured")}</p>}
      </section>

      {resolvedPresentation.comparisonRows.length > 0 && <section id="plan-comparison" className="manage-plan-card overflow-x-auto rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-5" aria-label={copyText("comparisonLabel", "Plan comparison")}>
        <div className="mb-3"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">{copyText("comparisonEyebrow", "Compare plans")}</p><h2 className="mt-1 text-base font-bold tracking-tight text-slate-950 dark:text-white">{copyText("comparisonTitle", "Plan features and limits")}</h2></div>
        <div className="min-w-[34rem]" role="table" aria-label={copyText("comparisonLabel", "Plan comparison")}>
          <div className="grid gap-2 border-b border-slate-100 pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:border-white/10 dark:text-slate-400" style={{ gridTemplateColumns: `minmax(9rem,1.4fr) repeat(${orderedPlans.length}, minmax(6rem,1fr))` }} role="row">
            <span role="columnheader">{copyText("comparisonFeatureLabel", "Feature")}</span>
            {orderedPlans.map((plan) => <span key={plan.key} className="text-center" role="columnheader">{planCopy(plan).label}</span>)}
          </div>
          {resolvedPresentation.comparisonRows.map((row) => <div key={row.key} className="grid gap-2 border-b border-slate-100 py-2.5 text-xs last:border-0 dark:border-white/10" style={{ gridTemplateColumns: `minmax(9rem,1.4fr) repeat(${orderedPlans.length}, minmax(6rem,1fr))` }} role="row">
            <span className="font-medium text-slate-700 dark:text-slate-200" role="rowheader">{row.label || (row.featureKey ? displayKey(row.featureKey) : row.limitKey ? usageMetricName(row.limitKey) : displayKey(row.key))}</span>
            {orderedPlans.map((plan) => <span key={plan.key} className={`text-center font-semibold tabular-nums ${row.kind === "feature" && plan.features[row.featureKey || ""] ? "text-emerald-600 dark:text-emerald-300" : "text-slate-600 dark:text-slate-300"}`} role="cell" aria-label={`${planCopy(plan).label}: ${comparisonValue(plan, row)}`}>{comparisonValue(plan, row)}</span>)}
          </div>)}
        </div>
      </section>}

      <PlanFeaturePreview plan={selectedPlan} currentPlanKey={currentPlan} presentation={presentation} usageMetrics={usageMetrics} />

      <section id="billing-details" className="manage-plan-card scroll-mt-6 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{t("manage.planUsage.billing.subscription")}</p><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950 dark:text-white">{t("manage.planUsage.billing.billingDetails")}</h2><p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{t("manage.planUsage.billing.billingDetailsDescription")}</p></div>{billing.canManage && billing.provider === "paddle" && billing.customerId && <Button type="button" onClick={manageBilling} loading={activeAction === "manage-billing"} className="min-h-10 rounded-xl border border-slate-200 bg-transparent px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10">{t("manage.planUsage.billing.manageBilling")}</Button>}</div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-white/10 dark:text-violet-300"><CreditCard className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{t("manage.planUsage.billing.paymentMethod")}</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{isPaid ? paymentMethodLabel : t("manage.planUsage.billing.noPaymentMethod")}</p></div></div>{isPaid && billing.canManage && <Button type="button" onClick={openPaymentMethod} loading={activeAction === "payment-method"} className="mt-4 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white">{t("manage.planUsage.billing.updatePaymentMethod")}</Button>}</div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-white/10 dark:text-violet-300"><ReceiptText className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{t("manage.planUsage.billing.invoices")}</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t("manage.planUsage.billing.invoicesDescription")}</p></div></div>{isPaid && billing.canManage && <Button type="button" onClick={() => loadHistory("view-invoices")} loading={activeAction === "view-invoices"} className="mt-4 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white">{t("manage.planUsage.billing.viewInvoices")}</Button>}</div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-white/10 dark:text-violet-300"><CalendarClock className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-slate-900 dark:text-white">{t("manage.planUsage.billing.subscription")}</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{billing.nextBilledAt ? t("manage.planUsage.billing.nextBill", { date: dateLabel(billing.nextBilledAt) || "" }) : isPaid ? t("manage.planUsage.billing.currentPeriodOnly") : t("manage.planUsage.billing.basePlanDetails")}</p></div></div>{isPaid && billing.canManage && billing.provider === "paddle" && billing.subscriptionId && <div className="mt-4 flex justify-end">{billing.cancelAtPeriodEnd ? <Button type="button" onClick={() => reactivate("reactivate-details")} loading={activeAction === "reactivate-details"} className="min-h-9 rounded-lg border border-emerald-200 bg-transparent px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10">{t("manage.planUsage.billing.reactivateSubscription")}</Button> : <Button type="button" onClick={cancelSubscription} className="min-h-9 rounded-lg border border-rose-200 bg-transparent px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-500/10">{t("manage.planUsage.billing.cancelAtPeriodEnd")}</Button>}</div>}</div>
        </div>
        {history && (
          <div className="mt-5 rounded-2xl border border-slate-200 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/10">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{t("manage.planUsage.billing.invoicesAndTransactions")}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("manage.planUsage.billing.invoicesDescription")}</p>
              </div>
              <Button type="button" onClick={() => loadHistory("refresh-invoices")} loading={activeAction === "refresh-invoices"} className="min-h-8 rounded-lg border border-slate-200 bg-transparent px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-white dark:hover:bg-white/10">
                {t("manage.planUsage.billing.refresh")}
              </Button>
            </div>
            {history.length === 0 ? <p className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">{t("manage.planUsage.billing.noTransactions")}</p> : (
              <div className="divide-y divide-slate-100 dark:divide-white/10">
                {history.map((transaction) => (
                  <div key={transaction.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{transaction.invoiceNumber || t("manage.planUsage.billing.transaction")}</p>
                      <p className="mt-0.5 text-slate-500 dark:text-slate-400">{transaction.date ? dateLabel(transaction.date) : "—"} · {transaction.status}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">{transaction.amount && transaction.currency ? formatPaddleAmount(transaction.amount, transaction.currency) : "—"}</span>
                      {transaction.id && <Button type="button" onClick={() => beginAction(`invoice:${transaction.id}`, async () => {
                        const result = await getBillingInvoiceUrl(transaction.id as string)
                        if (result.success && result.url) window.location.assign(result.url)
                        else setMessage(translateMessage(result.message || t("manage.planUsage.billing.actionFailed")))
                      })} loading={activeAction === `invoice:${transaction.id}`} className="min-h-7 rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-white dark:hover:bg-white/10">
                        {t("manage.planUsage.billing.invoice")} <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {configuredPaidPlans.includes(currentPlan) && billing.provider !== "paddle" && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-white/[0.03] dark:text-slate-300"><ShieldCheck className="mr-2 inline h-4 w-4" />{t("manage.planUsage.billing.grandfathered")}</p>}
      {(pending || activating) && <BillingOverlayPortal><div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-sm dark:bg-slate-950/55" role="status" aria-live="polite"><div className="billing-success-card flex w-full max-w-sm items-center gap-4 rounded-2xl border border-white/90 bg-white/95 p-5 shadow-[0_24px_70px_-30px_rgba(30,20,70,0.55)] dark:border-white/10 dark:bg-[#1c1b29]/95"><OrbLoader label={activating ? t("manage.planUsage.billing.activatingPlan") : t("common.updating")} size={activating ? "sm" : "md"} showLabel={false} className="shrink-0" /><div><p className="text-sm font-bold text-slate-950 dark:text-white">{activating ? t("manage.planUsage.billing.activatingPlan") : t("common.updating")}</p>{activating && <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t("manage.planUsage.billing.activatingAfterConfirmation")}</p>}</div></div></div></BillingOverlayPortal>}
      {message && <p className="text-sm text-slate-600 dark:text-slate-300" role="status">{message}</p>}

      <AlertDialog open={billingConfirmation !== null} onOpenChange={(open) => { if (!open) setBillingConfirmation(null) }}>
        <AlertDialogContent className="!flex !h-dvh !max-h-dvh !w-screen !max-w-none !flex-col !gap-0 overflow-hidden rounded-none border border-violet-200/70 bg-white p-0 shadow-2xl shadow-slate-950/20 dark:border-violet-400/20 dark:bg-[#1c1b29] sm:!h-auto sm:!max-h-[calc(100dvh-2rem)] sm:!w-full sm:!max-w-md sm:rounded-[1.75rem]">
          <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-4 dark:from-violet-500/15 dark:via-[#1c1b29] dark:to-indigo-500/10 sm:p-7">
            <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-violet-300/25 blur-3xl dark:bg-violet-400/10" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-200">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-white/10 dark:text-violet-200"><CreditCard className="h-4 w-4" /></span>
                {t("manage.planUsage.billing.reviewChange")}
              </div>
              <AlertDialogCancel asChild>
                <button type="button" aria-label={t("common.close")} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/80 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </AlertDialogCancel>
            </div>
            <AlertDialogHeader className="relative mt-4 text-left sm:mt-6">
              <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-2xl">
                {checkoutConfirmation ? `Start ${checkoutConfirmation.preview.plan}?` : planChangeConfirmation ? t("manage.planUsage.billing.changePlanDialogTitle", { plan: planChangeConfirmation.preview.plan }) : t("manage.planUsage.billing.cancelDialogTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300 sm:leading-6">
                {checkoutConfirmation
                  ? "Review the exact amount charged now and the configured recurring billing cycle before opening secure checkout."
                  : planChangeConfirmation
                  ? t(previewIsDowngrade ? "manage.planUsage.billing.changePlanDowngradeDescription" : "manage.planUsage.billing.changePlanDialogDescription")
                  : t("manage.planUsage.billing.cancelDialogDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>

          <div className="min-h-0 flex flex-1 flex-col overflow-y-auto px-4 py-4 sm:flex-none sm:overflow-visible sm:px-7 sm:pb-7 sm:pt-0">
            <div className="space-y-3 sm:space-y-4">
            {checkoutConfirmation ? (
              <div className="space-y-2.5 rounded-xl border border-violet-200 bg-violet-50/80 p-3 dark:border-violet-400/20 dark:bg-violet-500/10 sm:space-y-3 sm:rounded-2xl sm:p-4">
                <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-200">{checkoutConfirmation.preview.plan}</span><span className="text-sm font-bold text-violet-900 dark:text-white">{formatPaddleAmount(checkoutConfirmation.preview.amount, checkoutConfirmation.preview.currency) || "—"}</span></div>
                <div className="grid grid-cols-2 gap-2 text-xs text-violet-900 dark:text-violet-100"><div><p className="text-[9px] uppercase tracking-[0.1em] opacity-60">Charged today</p><p className="mt-0.5 font-bold">{formatPaddleAmount(checkoutConfirmation.preview.amount, checkoutConfirmation.preview.currency) || "—"}</p></div><div><p className="text-[9px] uppercase tracking-[0.1em] opacity-60">Recurring</p><p className="mt-0.5 font-bold">{formatPaddleAmount(checkoutConfirmation.preview.nextRecurringAmount, checkoutConfirmation.preview.currency) || "—"} / {checkoutConfirmation.preview.interval}</p></div></div>
              </div>
            ) : planChangeConfirmation ? (
              <>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.04] sm:gap-3 sm:rounded-2xl sm:p-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("manage.planUsage.billing.changePlanCurrent")}</p>
                    <p className="mt-1 truncate text-sm font-bold text-slate-900 dark:text-white">{currentPlanName}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-violet-500" />
                  <div className="min-w-0 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">{t("manage.planUsage.billing.changePlanNew")}</p>
                    <p className="mt-1 truncate text-sm font-bold text-violet-700 dark:text-violet-200">{planChangeConfirmation.preview.plan}</p>
                  </div>
                </div>

                <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${previewIsCredit ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-500/10" : "border-violet-200 bg-violet-50/80 dark:border-violet-400/20 dark:bg-violet-500/10"}`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${previewIsCredit ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200" : "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200"}`}>
                      {previewIsCredit ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[13px] font-bold ${previewIsCredit ? "text-emerald-900 dark:text-emerald-100" : "text-violet-950 dark:text-violet-100"}`}>{previewActionLabel}</p>
                      <p className={`mt-0.5 text-[10px] leading-4 ${previewIsCredit ? "text-emerald-800/75 dark:text-emerald-200/75" : "text-violet-800/75 dark:text-violet-200/75"}`}>{previewTimingLabel}</p>
                    </div>
                  </div>
                  {previewAmount && <p className={`shrink-0 text-base font-bold tabular-nums ${previewIsCredit ? "text-emerald-700 dark:text-emerald-200" : "text-violet-700 dark:text-violet-200"}`}>{previewAmount}</p>}
                </div>
                {previewCreditToBalance && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] leading-4 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">{t("manage.planUsage.billing.changePlanCreditRemaining", { amount: previewCreditToBalance })}</p>}
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-white/10 dark:bg-white/[0.03]"><div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">New recurring price</p><p className="mt-0.5 font-bold text-slate-900 dark:text-white">{formatPaddleAmount(planChangeConfirmation.preview.recurringAmount, planChangeConfirmation.preview.recurringCurrency || planChangeConfirmation.preview.currency) || "—"} / {planChangeConfirmation.preview.interval}</p></div><div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{previewIsDowngrade ? "Effective date" : "Next billing date"}</p><p className="mt-0.5 font-bold text-slate-900 dark:text-white">{dateLabel(previewIsDowngrade ? planChangeConfirmation.preview.effectiveAt : (planChangeConfirmation.preview.nextBilledAt || planChangeConfirmation.preview.effectiveAt)) || "—"}</p></div></div>
              </>
            ) : (
              <div className="space-y-2.5 rounded-xl border border-rose-200 bg-rose-50/80 p-3 dark:border-rose-400/20 dark:bg-rose-500/10 sm:space-y-3 sm:rounded-2xl sm:p-4">
                <p className="text-sm font-bold text-rose-900 dark:text-rose-100">{t("manage.planUsage.billing.cancelAtPeriodEnd")}</p>
                <p className="mt-1 text-[11px] leading-5 text-rose-800/75 dark:text-rose-200/75">{t("manage.planUsage.billing.cancellationConfirm")}</p>
                <label className="block text-xs font-semibold text-rose-950 dark:text-rose-100">Why are you leaving?
                  <select value={cancellationReason} onChange={(event) => { setCancellationReason(event.target.value); setBillingConfirmation((current) => current?.type === "cancel" ? { ...current, reason: event.target.value } : current) }} className="mt-1.5 h-10 w-full rounded-lg border border-rose-200 bg-white px-2 text-xs text-slate-900 dark:border-rose-300/20 dark:bg-white/10 dark:text-white">
                    <option value="too_expensive">Too expensive</option><option value="not_using">Not using the workspace enough</option><option value="seasonal">Seasonal or temporary pause</option><option value="missing_feature">Missing a feature</option><option value="technical_problem">Technical problems</option><option value="switching_solution">Switching to another solution</option><option value="other">Other</option>
                  </select>
                </label>
                <textarea value={cancellationFeedback} onChange={(event) => { setCancellationFeedback(event.target.value); setBillingConfirmation((current) => current?.type === "cancel" ? { ...current, feedback: event.target.value } : current) }} maxLength={1000} rows={2} placeholder="Optional feedback" className="w-full rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 dark:border-rose-300/20 dark:bg-white/10 dark:text-white" />
              </div>
            )}
            </div>

            <AlertDialogFooter className="mt-auto gap-1.5 pt-3 sm:space-x-0 sm:gap-2">
              <AlertDialogCancel asChild>
                <Button type="button" variant="outline" className="min-h-10 flex-1 rounded-lg border-slate-200 bg-transparent text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10">
                  {checkoutConfirmation ? "Cancel" : planChangeConfirmation ? t("manage.planUsage.billing.keepCurrentPlan") : t("manage.planUsage.billing.keepSubscription")}
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button type="button" loading={activeAction === "confirm-billing"} onClick={confirmBillingAction} className={`min-h-10 flex-1 rounded-lg text-sm font-semibold text-white ${planChangeConfirmation ? "bg-violet-600 hover:bg-violet-700" : "bg-rose-600 hover:bg-rose-700"}`}>
                  {checkoutConfirmation ? "Continue to secure checkout" : planChangeConfirmation ? t("manage.planUsage.billing.confirmPlanChange") : t("manage.planUsage.billing.scheduleCancellation")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
