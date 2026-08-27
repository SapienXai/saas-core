import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, AppShell, Button, Card, Dialog, DropdownMenu, EmptyState, InputOTP, NativeSelect, Popover, Select, Sheet, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip, WorkspaceSwitcher, getStatusLabel, resolveThemeConfig, responsiveEntityPresentation } from "./index.js"

describe("SaaS Core UI public foundation", () => {
  it("keeps the 1.1 public exports working while using the new semantic classes", () => {
    const markup = renderToStaticMarkup(<AppShell productName="Acme" nav={[{ label: "Overview", href: "/app", active: true }]}><EmptyState title="Nothing here" description="Start by creating a workspace." /></AppShell>)
    expect(markup).toContain("sc-shell")
    expect(markup).toContain("Nothing here")
    expect(markup).toContain("aria-current=\"page\"")
  })

  it("renders accessible primitive contracts and status variants", () => {
    const markup = renderToStaticMarkup(<Card><Button variant="outline" size="lg">Continue</Button><StatusBadge status="past_due" /></Card>)
    expect(markup).toContain("sc-button-outline")
    expect(markup).toContain("sc-button-lg")
    expect(markup).toContain("sc-badge-warning")
    expect(getStatusLabel("healthy").tone).toBe("success")
  })

  it("keeps workspace switching as a presentation-only contract", () => {
    const markup = renderToStaticMarkup(<WorkspaceSwitcher workspaces={[{ id: "one", name: "One", slug: "one" }]} />)
    expect(markup).toContain('action="/api/workspaces/select"')
    expect(markup).toContain('name="workspaceId"')
  })

  it("falls back safely for invalid optional theme values", () => {
    expect(resolveThemeConfig({ mode: "invalid", radius: "broken", preset: "unknown" })).toMatchObject({ mode: "system", radius: "medium", preset: "default" })
    expect(resolveThemeConfig(null).primary).toBe("#6757e8")
  })

  it("exposes the responsive table/card presentation contract", () => {
    expect(responsiveEntityPresentation([{ id: 1 }])).toMatchObject({ breakpoint: 768, mobileMode: "cards", desktopMode: "table" })
  })

  it("keeps the reusable primitive breadth provider-free and semantic", () => {
    const markup = renderToStaticMarkup(<><Accordion><AccordionItem><AccordionTrigger>Details</AccordionTrigger><AccordionContent>Content</AccordionContent></AccordionItem></Accordion><Tabs><TabsList><TabsTrigger aria-selected="true">One</TabsTrigger></TabsList><TabsContent>Panel</TabsContent></Tabs></>)
    expect(markup).not.toContain("<details")
    expect(markup).toContain("role=\"tablist\"")
    expect(markup).toContain("role=\"tabpanel\"")
  })

  it("exports real interactive primitive roots and an explicit native form helper", () => {
    for (const primitive of [Dialog, DropdownMenu, InputOTP, Popover, Select, Sheet, Tooltip]) {
      expect(primitive).toBeDefined()
    }
    expect(renderToStaticMarkup(<NativeSelect aria-label="Native fallback"><option value="one">One</option></NativeSelect>)).toContain("sc-select-native")
    expect(renderToStaticMarkup(<Button asChild><a href="/app">Open app</a></Button>)).toContain('href="/app"')
  })
})
