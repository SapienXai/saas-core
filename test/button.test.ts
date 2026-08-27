import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Button } from "../components/ui/button"

describe("Button", () => {
  it("keeps asChild content as a single Slot child", () => {
    expect(() => renderToStaticMarkup(
      React.createElement(
        Button,
        { asChild: true, variant: "outline" },
        React.createElement("a", { href: "/manage/domains" }, "Open domains"),
      ),
    )).not.toThrow()
  })

  it("renders the loading indicator for regular buttons", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Button, { loading: true }, "Saving"),
    )

    expect(markup).toContain("Saving")
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-label="Loading"')
    expect(markup).toContain("disabled")
  })
})
