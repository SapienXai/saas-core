import { describe, expect, it } from "vitest"
import { getPlanNavigationHref } from "../lib/plan-navigation"

describe("plan navigation", () => {
  it("keeps the existing direct plan URL for an owned workspace", () => {
    expect(getPlanNavigationHref({
      language: "tr",
      plan: "pro",
      currentWorkspaceId: "workspace-own",
      ownedWorkspaceId: "workspace-own",
    })).toBe("/manage/plan?lang=tr&plan=pro")
  })

  it("asks the manage layout to select the user's owned workspace first", () => {
    expect(getPlanNavigationHref({
      language: "en",
      plan: "pro",
      hash: "#upgrade-plans",
      currentWorkspaceId: "workspace-shared",
      ownedWorkspaceId: "workspace-own",
    })).toBe("/manage/plan?lang=en&plan=pro&workspace=workspace-own#upgrade-plans")
  })

  it("supports the workspace upgrade modal without a selected current workspace", () => {
    expect(getPlanNavigationHref({
      hash: "#upgrade-plans",
      ownedWorkspaceId: "workspace-own",
    })).toBe("/manage/plan?workspace=workspace-own#upgrade-plans")
  })
})
