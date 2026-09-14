import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { resolveBillingPresentation } from "../components/manage/paddle-billing-actions"

const root = process.cwd()
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

describe("reusable billing UI", () => {
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
    expect(source).toContain("transitionId")
  })

  it("keeps scheduled downgrade, free/no-price, recovery, and authorization states actionable", () => {
    const page = read("app/manage/plan/page.tsx")
    const actions = read("components/manage/paddle-billing-actions.tsx")
    const banner = read("components/manage/scheduled-plan-change-banner.tsx")
    const success = read("components/manage/billing-success-experience.tsx")
    expect(page).toContain("ScheduledPlanChangeBanner")
    expect(banner).toContain("timeStyle: \"short\"")
    expect(banner).toContain("dateTime={effectiveAt")
    expect(actions).toContain("billingSetupRequired")
    expect(actions).toContain("billingIssueCode === \"past_due\"")
    expect(actions).toContain("recoverPayment")
    expect(actions).toContain("billing.canManage")
    expect(success).toContain("prefers-reduced-motion")
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
  })

  it("keeps source and template billing surfaces in parity", () => {
    const pairs = [
      ["components/manage/billing-success-experience.tsx", "packages/app/template/components/manage/billing-success-experience.tsx"],
      ["components/manage/paddle-billing-actions.tsx", "packages/app/template/components/manage/paddle-billing-actions.tsx"],
      ["components/manage/manage-sidebar.tsx", "packages/app/template/components/manage/manage-sidebar.tsx"],
      ["components/manage/scheduled-plan-change-banner.tsx", "packages/app/template/components/manage/scheduled-plan-change-banner.tsx"],
      ["components/manage/plan-feature-preview.tsx", "packages/app/template/components/manage/plan-feature-preview.tsx"],
      ["components/manage/entitlement-limit-notice.tsx", "packages/app/template/components/manage/entitlement-limit-notice.tsx"],
      ["app/manage/plan/page.tsx", "packages/app/template/app/manage/plan/page.tsx"],
      ["app/platform/billing/page.tsx", "packages/app/template/app/platform/billing/page.tsx"],
      ["app/manage/plan/actions.ts", "packages/app/template/app/manage/plan/actions.ts"],
      ["src/product/usage.ts", "packages/app/template/src/product/usage.ts"],
    ] as const
    for (const [sourcePath, templatePath] of pairs) expect(read(sourcePath), templatePath).toBe(read(templatePath))
    expect(read("packages/app/template/app/app/plan/page.tsx")).toContain('export { default } from "@/app/manage/plan/page"')
  })
})
