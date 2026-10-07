import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { resolveBillingPresentation } from "../components/manage/paddle-billing-actions"

const root = process.cwd()
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

describe("reusable billing UI", () => {
  it("renders the deferred billing state without provider actions", () => {
    const source = read("components/manage/paddle-billing-actions.tsx")
    const provider = read("lib/billing/paddle-client.ts")
    const actions = read("app/manage/plan/actions.ts")

    expect(provider).toContain('process.env.SAAS_CORE_BILLING_MODE === "deferred"')
    expect(provider).toContain('"BILLING_DEFERRED"')
    expect(actions).toContain("billingDeferred: billingPresentation.billingDeferred")
    expect(source).toContain('data-billing-mode="deferred"')
    expect(source).toContain("billingDeferredNotice")
    expect(source).toContain("if (billing.billingDeferred)")
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

  it("gates celebrations on reconciled durable transition consumption and dedupes replay", () => {
    const source = read("components/manage/paddle-billing-actions.tsx")
    expect(source).toContain("consumeBillingTransitionForCurrentUser")
    expect(source).toContain("consumption.data.consumed")
    expect(source).toContain("reconcilePaddleSubscription()")
    expect(source).toContain("window.setTimeout(refreshUntilVerified, 2500)")
    expect(source).toContain("checkoutOutcomeRef.current")
    expect(source).toContain("reconcilePaddleCheckoutTransaction")
    expect(source).toContain("pendingOutcome.transactionId")
    expect(source).toContain("transitionId")
  })

  it("keeps scheduled downgrade, free/no-price, recovery, and authorization states actionable", () => {
    const page = read("app/manage/plan/page.tsx")
    const actions = read("components/manage/paddle-billing-actions.tsx")
    const planActions = read("app/manage/plan/actions.ts")
    const banner = read("components/manage/scheduled-plan-change-banner.tsx")
    const success = read("components/manage/billing-success-experience.tsx")
    expect(page).toContain("ScheduledPlanChangeBanner")
    expect(banner).toContain("timeStyle: \"short\"")
    expect(banner).toContain("dateTime={effectiveAt")
    expect(actions).toContain("billingSetupRequired")
    expect(actions).toContain("data-billing-interval-change")
    expect(actions).toContain("changeBillingCycleDialogTitle")
    expect(actions).toContain("confirmation.preview.interval")
    expect(actions).toContain('preview.changeTiming === "period_end"')
    expect(actions).toContain("isScheduledPeriodEnd")
    expect(actions).toContain("hasPendingBillingCycleChange")
    expect(actions).toContain("billingIssueCode === \"past_due\"")
    expect(actions).toContain("recoverPayment")
    expect(actions).toContain("billing.canManage")
    expect(planActions).toContain("planChangeFingerprint")
    expect(planActions).toContain("The billing state changed. Review the new preview before confirming.")
    expect(planActions).toContain("subscription.plan_key === targetPlan && !currentInterval")
    expect(planActions).toContain('transitionKind = isIntervalChange ? "interval_change"')
    expect(planActions).toContain('prorationBillingMode = intervalPolicy.kind === "interval_change"')
    expect(planActions).toContain('shouldPersistScheduledProjection = isDowngrade || changeTiming === "period_end"')
    expect(planActions).toContain("fresh.nextBilledAt !== saved.nextBilledAt")
    expect(planActions).toContain("changeTiming, effectiveAt, providerReference")
    expect(planActions).toContain('isIntervalChange ? "The pending billing cycle change was undone."')
    expect(planActions).toContain("The workspace is already on that plan and billing cycle.")
    expect(planActions).toContain("Paddle ${environment} ${interval} price mapping is not configured")
    expect(planActions).toContain("billing_checkout_sessions")
    expect(planActions).toContain("transactions.get(requestedTransactionId)")
    expect(planActions).toContain("The browser never grants access")
    expect(success).toContain("prefers-reduced-motion")
    expect(success).toContain("isScheduledBilling")
    expect(banner).toContain('billingCycleChangeLabel')
    expect(banner).toContain('billingCycleChangeScheduledDescription')
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

  it("keeps source and template billing surfaces in parity", () => {
    const pairs = [
      ["components/manage/billing-success-experience.tsx", "packages/app/template/components/manage/billing-success-experience.tsx"],
      ["components/manage/paddle-billing-actions.tsx", "packages/app/template/components/manage/paddle-billing-actions.tsx"],
      ["components/manage/manage-sidebar.tsx", "packages/app/template/components/manage/manage-sidebar.tsx"],
      ["lib/management-sidebar-usage.ts", "packages/app/template/lib/management-sidebar-usage.ts"],
      ["components/manage/scheduled-plan-change-banner.tsx", "packages/app/template/components/manage/scheduled-plan-change-banner.tsx"],
      ["components/manage/plan-feature-preview.tsx", "packages/app/template/components/manage/plan-feature-preview.tsx"],
      ["components/manage/entitlement-limit-notice.tsx", "packages/app/template/components/manage/entitlement-limit-notice.tsx"],
      ["app/manage/plan/page.tsx", "packages/app/template/app/manage/plan/page.tsx"],
      ["app/platform/billing/page.tsx", "packages/app/template/app/platform/billing/page.tsx"],
      ["app/manage/plan/actions.ts", "packages/app/template/app/manage/plan/actions.ts"],
      ["src/product/usage.ts", "packages/app/template/src/product/usage.ts"],
      ["src/product/platform-admin.ts", "packages/app/template/src/product/platform-admin.ts"],
      ["lib/billing/interval-policy.ts", "packages/app/template/lib/billing/interval-policy.ts"],
      ["lib/billing/presentation.ts", "packages/app/template/lib/billing/presentation.ts"],
      ["i18n/locales/en.ts", "packages/app/template/i18n/locales/en.ts"],
      ["i18n/locales/tr.ts", "packages/app/template/i18n/locales/tr.ts"],
      ["i18n/locales/es.ts", "packages/app/template/i18n/locales/es.ts"],
    ] as const
    for (const [sourcePath, templatePath] of pairs) expect(read(sourcePath), templatePath).toBe(read(templatePath))
    expect(read("packages/app/template/app/app/plan/page.tsx")).toContain('export { default } from "@/app/manage/plan/page"')
  })

  it("checks downgrade eligibility again before scheduling or calling Paddle", () => {
    const actions = read("app/manage/plan/actions.ts")
    const templateActions = read("packages/app/template/app/manage/plan/actions.ts")
    const freshPreview = actions.indexOf("freshPreview =")
    const confirmationEligibility = actions.indexOf("validatePlanChangeEligibility(membership.workspace_id, targetPlan)", freshPreview)
    const providerMutation = actions.indexOf("subscriptions.update", confirmationEligibility)
    const cancellation = actions.indexOf("export async function cancelPaddleSubscription")
    const resume = actions.indexOf("export async function resumePaddleSubscription")

    expect(actions).toContain("validatePlanChangeEligibility(subscription.workspace_id, targetPlan)")
    expect(actions).toContain("PLAN_CHANGE_NOT_ELIGIBLE")
    expect(confirmationEligibility).toBeGreaterThan(freshPreview)
    expect(providerMutation).toBeGreaterThan(confirmationEligibility)
    expect(actions.slice(cancellation, resume)).not.toContain("validatePlanChangeEligibility")
    expect(templateActions).toBe(actions)
  })
})
