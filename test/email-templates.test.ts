import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { buildWorkspaceInvitationEmail } from "../lib/invitation-email"
import { renderEmailDetails, renderReserveviaEmail } from "../lib/email-template"
import { generateReservationConfirmationEmail, generateStatusUpdateEmail } from "../lib/reservation-email-templates"

describe("Reservevia account email templates", () => {
  it("renders a branded invitation with a CTA and a plain-text fallback", () => {
    const email = buildWorkspaceInvitationEmail({
      to: "member@example.com",
      token: "preview-invitation-token",
      workspaceName: "A <Restaurant>",
      inviterLabel: "Owner & team",
      role: "Manager",
      accessLabel: "Main location",
      expiresAt: "2026-08-17T12:00:00.000Z",
    })

    expect(email.html).toContain("Accept invitation")
    expect(email.html).toContain("role=\"presentation\"")
    expect(email.html).toContain("A &lt;Restaurant&gt;")
    expect(email.html).toContain("If the button does not work")
    expect(email.text).toContain("Accept invitation:")
    expect(email.text).toContain("preview-invitation-token")
  })

  it("keeps account templates CTA-first and uses the server-side token-hash callback", () => {
    const confirmation = readFileSync(new URL("../supabase/templates/confirmation.html", import.meta.url), "utf8")
    const recovery = readFileSync(new URL("../supabase/templates/recovery.html", import.meta.url), "utf8")

    for (const template of [confirmation, recovery]) {
      expect(template).toContain("{{ .RedirectTo }}")
      expect(template).toContain("{{ .TokenHash }}")
      expect(template).toContain("If the button does not work")
      expect(template).toContain("RESERVEVIA")
      expect(template).toContain("viewport")
      expect(template).toContain("email-content")
      expect(template).not.toContain("href=\"#\"")
    }

    expect(confirmation).toContain("Confirm email")
    expect(recovery).toContain("Choose a new password")
  })

  it("escapes dynamic text while keeping CTA links usable", () => {
    const html = renderReserveviaEmail({
      preheader: "Preview",
      eyebrow: "Account setup",
      title: "A <title>",
      intro: "Hello",
      content: renderEmailDetails([{ label: "Workspace", value: "A & B" }]),
      cta: { label: "Continue", href: "https://app.reservevia.com/confirm?next=%2Fmanage" },
    })

    expect(html).toContain("A &lt;title&gt;")
    expect(html).toContain("A &amp; B")
    expect(html).toContain("https://app.reservevia.com/confirm?next=%2Fmanage")
  })

  it("gives customers a manage link in confirmation and confirmed emails", () => {
    const manageUrl = "https://bono.reservevia.com/?manageToken=rv_manage_preview_token"
    const confirmation = generateReservationConfirmationEmail({
      customerName: "Ayse Yilmaz",
      restaurantName: "Bono",
      reservationDate: "Sunday, August 16, 2026",
      reservationTime: "22:00",
      partySize: 2,
      manageUrl,
      lang: "en",
    })
    const confirmed = generateStatusUpdateEmail({
      customerName: "Ayse Yilmaz",
      restaurantName: "Bono",
      reservationDate: "Sunday, August 16, 2026",
      reservationTime: "22:00",
      partySize: 2,
      status: "confirmed",
      manageUrl,
      lang: "en",
    })

    for (const email of [confirmation, confirmed]) {
      expect(email.html).toContain("Manage reservation")
      expect(email.html).toContain("manageToken=rv_manage_preview_token")
      expect(email.html).toContain("If the button does not work")
      expect(email.text).toContain(`Manage reservation: ${manageUrl}`)
    }
  })
})
