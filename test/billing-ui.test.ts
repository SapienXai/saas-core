import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { resolveBillingPresentation } from "../components/manage/billing-actions"
import { localeMessages } from "@/i18n/messages"

const root = process.cwd()
const read = (path: string) => readFileSync(root + "/" + path, "utf8")

describe("provider-neutral billing UI", () => {
  it("renders deferred billing without exposing provider mutations", () => {
    const source = read("components/manage/billing-actions.tsx")
    const config = read("lib/billing/config.ts")
    const actions = read("app/manage/plan/actions.ts")

    expect(config).toContain('process.env.SAAS_CORE_BILLING_MODE === "deferred"')
    expect(config).toContain('"BILLING_DEFERRED"')
    expect(actions).toContain("billingDeferred: presentation.billingDeferred")
    expect(source).toContain('data-billing-mode="deferred"')
    expect(source).toContain("billing-deferred-notice")
    expect(source).toContain("if (billing.billingDeferred)")
  })

  it("keeps purchase confirmation clear, localized, and visually distinct from cancellation", () => {
    const source = read("components/manage/billing-actions.tsx")
    const localizedKeys = [
      "common.cancel",
      "manage.planUsage.billing.checkoutConfirmTitle",
      "manage.planUsage.billing.checkoutConfirmDescription",
      "manage.planUsage.billing.checkoutDueToday",
      "manage.planUsage.billing.checkoutRecurring",
      "manage.planUsage.billing.continueToSecureCheckout",
      "manage.planUsage.billing.newRecurringPrice",
      "manage.planUsage.billing.effectiveDate",
      "manage.planUsage.billing.nextBillingDate",
      "manage.planUsage.billing.cancellationReasonPrompt",
      "manage.planUsage.billing.cancellationFeedbackPlaceholder",
      "manage.planUsage.billing.cancellationReasonTooExpensive",
      "manage.planUsage.billing.cancellationReasonNotUsing",
      "manage.planUsage.billing.cancellationReasonSeasonal",
      "manage.planUsage.billing.cancellationReasonMissingFeature",
      "manage.planUsage.billing.cancellationReasonTechnical",
      "manage.planUsage.billing.cancellationReasonSwitching",
      "manage.planUsage.billing.cancellationReasonOther",
      "manage.planUsage.billing.freePlan",
      "manage.planUsage.billing.freePlanScheduled",
      "manage.planUsage.billing.switchToFree",
    ] as const
    const valueAt = (language: keyof typeof localeMessages, path: string) => path.split(".").reduce<unknown>(
      (value, segment) => typeof value === "object" && value !== null ? (value as Record<string, unknown>)[segment] : undefined,
      localeMessages[language],
    )

    expect(source).toContain('checkoutConfirmation || planChangeConfirmation ? "bg-violet-600 hover:bg-violet-700" : "bg-rose-600 hover:bg-rose-700"')
    expect(source).not.toContain('"Charged today"')
    expect(source).not.toContain('"Continue to secure checkout"')
    for (const key of localizedKeys) {
      const english = valueAt("en", key)
      expect(typeof english).toBe("string")
      expect(valueAt("es", key), `es:${key}`).not.toBe(english)
      expect(valueAt("tr", key), `tr:${key}`).not.toBe(english)
    }
  })

  it("resolves product plan order, intervals, feature labels, and limit rows", () => {
    const resolved = resolveBillingPresentation(
      [{ key: "starter_2" }, { key: "team_plus" }],
      {
        planOrder: ["team_plus", "starter_2"],
        copy: { "feature.exports": "Exports" },
        featureKeys: ["exports"],
        limitKeys: ["seats"],
        comparison: [{ key: "seats", label: "Seats", kind: "limit", limitKey: "seats" }],
      },
      ["year"],
      "month",
    )

    expect(resolved.planOrder).toEqual(["team_plus", "starter_2"])
    expect(resolved.supportedIntervals).toEqual(["year"])
    expect(resolved.defaultInterval).toBe("year")
    expect(resolved.comparisonRows).toEqual([{ key: "seats", label: "Seats", kind: "limit", limitKey: "seats" }])
  })

  it("gates celebrations on durable transition consumption and verifies Checkout server-side", () => {
    const source = read("components/manage/billing-actions.tsx")
    const actions = read("app/manage/plan/actions.ts")
    const webhook = read("lib/billing/stripe-webhook.ts")

    expect(source).toContain("consumeBillingTransitionForCurrentUser")
    expect(source).toContain("consumption.data.consumed")
    expect(source).toContain("reconcileSubscription()")
    expect(source).toContain("reconcileCheckoutSession")
    expect(source).toContain('searchParams.get("checkout_session_id")')
    expect(source).toContain("pendingOutcome.checkoutSessionId")
    expect(source).toContain("window.setTimeout(refreshUntilVerified, 2500)")
    expect(source).not.toContain("@paddle/paddle-js")
    expect(actions).toContain("reconcileBillingCheckoutSession")
    expect(webhook).toContain("A completed Checkout return never grants access")
    expect(webhook).toContain("validateInitialCheckoutCorrelation")
    expect(webhook).toContain("claimWorkspaceProjection")
  })

  it("resumes a matching pending hosted Checkout before the duplicate-mutation guard", () => {
    const actions = read("app/manage/plan/actions.ts")
    const startCheckout = actions.slice(actions.indexOf("export async function startCheckout"), actions.indexOf("export async function createBillingPortalSession"))

    expect(startCheckout.indexOf("resumePendingCheckoutSession")).toBeGreaterThanOrEqual(0)
    expect(startCheckout.indexOf("resumePendingCheckoutSession")).toBeLessThan(startCheckout.indexOf("beginBillingMutation"))
    expect(startCheckout).not.toContain('revalidatePath("/manage/plan")')
  })

  it("keeps scheduled changes, free plans, payment recovery, and authorization actionable", () => {
    const page = read("app/manage/plan/page.tsx")
    const actions = read("components/manage/billing-actions.tsx")
    const planActions = read("app/manage/plan/actions.ts")
    const banner = read("components/manage/scheduled-plan-change-banner.tsx")
    const success = read("components/manage/billing-success-experience.tsx")

    expect(page).toContain("ScheduledPlanChangeBanner")
    expect(banner).toContain("timeStyle: \"short\"")
    expect(banner).toContain("dateTime={effectiveAt")
    expect(actions).toContain("billingSetupRequired")
    expect(actions).toContain("switchToFree")
    expect(actions).toContain("switchesToFree ? cancelSubscription()")
    expect(actions).toContain('isFreePlan ? t("manage.planUsage.billing.freePlan")')
    expect(actions).toContain("data-billing-interval-change")
    expect(actions).toContain("changeBillingCycleDialogTitle")
    expect(actions).toContain("confirmation.preview.interval")
    expect(actions).toContain('preview.changeTiming === "period_end"')
    expect(actions).toContain("isScheduledPeriodEnd")
    expect(actions).toContain("hasPendingBillingCycleChange")
    expect(actions).toContain('billingIssueCode === "past_due"')
    expect(actions).toContain("recoverPayment")
    expect(actions).toContain("billing.canManage")
    expect(planActions).toContain("planChangeFingerprint")
    expect(planActions).toContain("The billing state changed. Review the new preview before confirming.")
    expect(planActions).toContain("schedulePlanChange({")
    expect(planActions).toContain("updateSubscriptionPrice({")
    expect(planActions).toContain("releaseSchedule(")
    expect(planActions).toContain("billing_checkout_sessions")
    expect(success).toContain("prefers-reduced-motion")
    expect(success).toContain("isScheduledBilling")
    expect(banner).toContain("billingCycleChangeLabel")
    expect(banner).toContain("billingCycleChangeScheduledDescription")
    expect(banner).not.toContain('billingCycleChangeScheduled", { date: "" })')
  })

  it("exposes product-neutral usage and limit-reached primitives", () => {
    const appNotice = read("components/manage/entitlement-limit-notice.tsx")
    const packageBilling = read("packages/ui/src/components/billing.tsx")
    expect(appNotice).toContain("data-entitlement-capability={capability}")
    expect(appNotice).toContain("limit === undefined")
    expect(appNotice).toContain("requiredPlan")
    expect(packageBilling).toContain("Limit unavailable")
    expect(packageBilling).toContain("/ Unlimited")
    expect(read("app/manage/plan/page.tsx")).toContain("usage.metrics[key] ?? undefined")
    expect(read("app/manage/plan/actions.ts")).toContain("getProductUsageResolvers")
    expect(read("components/manage/manage-responsive.tsx")).toContain("value: number | undefined")
    expect(read("src/product/usage.ts")).toContain('import "server-only"')
    expect(read("src/product/platform-admin.ts")).toContain("getProductPlatformWorkspaceDetails")
  })

  it("keeps canonical source and app template billing surfaces in parity", () => {
    const pairs = [
      ["components/manage/billing-success-experience.tsx", "packages/app/template/components/manage/billing-success-experience.tsx"],
      ["components/manage/billing-actions.tsx", "packages/app/template/components/manage/billing-actions.tsx"],
      ["components/manage/manage-sidebar.tsx", "packages/app/template/components/manage/manage-sidebar.tsx"],
      ["components/manage/scheduled-plan-change-banner.tsx", "packages/app/template/components/manage/scheduled-plan-change-banner.tsx"],
      ["components/manage/plan-feature-preview.tsx", "packages/app/template/components/manage/plan-feature-preview.tsx"],
      ["components/manage/entitlement-limit-notice.tsx", "packages/app/template/components/manage/entitlement-limit-notice.tsx"],
      ["app/manage/plan/page.tsx", "packages/app/template/app/manage/plan/page.tsx"],
      ["app/manage/plan/actions.ts", "packages/app/template/app/manage/plan/actions.ts"],
      ["app/api/cron/billing/lifecycle/route.ts", "packages/app/template/app/api/cron/billing/lifecycle/route.ts"],
      ["lib/billing/config.ts", "packages/app/template/lib/billing/config.ts"],
      ["lib/billing/provider.ts", "packages/app/template/lib/billing/provider.ts"],
      ["lib/billing/interval-policy.ts", "packages/app/template/lib/billing/interval-policy.ts"],
      ["lib/billing/lifecycle.ts", "packages/app/template/lib/billing/lifecycle.ts"],
      ["lib/billing/providers/index.ts", "packages/app/template/lib/billing/providers/index.ts"],
      ["lib/billing/providers/stripe.ts", "packages/app/template/lib/billing/providers/stripe.ts"],
      ["lib/billing/reconciliation-service.ts", "packages/app/template/lib/billing/reconciliation-service.ts"],
      ["lib/billing/stripe-webhook.ts", "packages/app/template/lib/billing/stripe-webhook.ts"],
      ["i18n/locales/en.ts", "packages/app/template/i18n/locales/en.ts"],
      ["i18n/locales/tr.ts", "packages/app/template/i18n/locales/tr.ts"],
      ["i18n/locales/es.ts", "packages/app/template/i18n/locales/es.ts"],
    ] as const
    for (const [sourcePath, templatePath] of pairs) expect(read(sourcePath), templatePath).toBe(read(templatePath))
    expect(read("packages/app/template/app/app/plan/page.tsx")).toContain('export { default } from "@/app/manage/plan/page"')
  })

  it("rechecks downgrade eligibility immediately before applying the provider schedule", () => {
    const actions = read("app/manage/plan/actions.ts")
    const templateActions = read("packages/app/template/app/manage/plan/actions.ts")
    const preview = actions.indexOf("const currentPreview = await calculatePlanChangePreview(context)")
    const eligibility = actions.indexOf("validatePlanChangeEligibility(membership.workspace_id, targetPlan)", preview)
    const providerMutation = actions.indexOf("schedulePlanChange({", eligibility)
    const cancellation = actions.indexOf("export async function cancelSubscription")
    const resume = actions.indexOf("export async function resumeSubscription")

    expect(actions).toContain("validatePlanChangeEligibility(context.subscription.workspace_id, targetPlan)")
    expect(eligibility).toBeGreaterThan(preview)
    expect(providerMutation).toBeGreaterThan(eligibility)
    expect(actions.slice(cancellation, resume)).not.toContain("validatePlanChangeEligibility")
    expect(templateActions).toBe(actions)
  })

  it("replaces a pending schedule directly and treats projection lock contention as a sync delay", () => {
    const actions = read("app/manage/plan/actions.ts")
    const billingUi = read("components/manage/billing-actions.tsx")

    expect(actions).toContain("replacesScheduledPlan")
    expect(actions).toContain("replacesScheduledCycle")
    expect(actions).toContain('if (isProjectionBusyError(error)) return false')
    expect(actions).toContain('releaseSchedule(subscription.provider_subscription_id, state.subscription.scheduleId, mutation.id, "cancel")')
    expect(actions).toContain("providerState.scheduledPlan?.priceId !== context.mapping.provider_price_id")
    expect(billingUi).toContain("isAlreadyScheduled")
    expect(billingUi).toContain("cancelReplacesScheduledPlan")
  })
})
