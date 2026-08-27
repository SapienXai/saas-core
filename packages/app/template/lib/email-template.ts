import "server-only"

import { getConfiguredRootDomain } from "@/lib/domains/hostname"
import { PRODUCT_CONFIG } from "@/lib/product-config"
import { getEmailMessages } from "@/i18n/email-messages"
import { resolveLanguage } from "@/i18n/config"

export type EmailDetail = {
  label: string
  value: string
}

export type EmailCta = {
  label: string
  href: string
  fallbackLabel?: string
}

type EmailTemplateOptions = {
  lang?: string
  preheader: string
  eyebrow: string
  title: string
  intro?: string
  content?: string
  cta?: EmailCta
  footerNote?: string
  accentColor?: string
}

export function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character)
}

function safeUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "#"
  } catch {
    return "#"
  }
}

export function renderEmailDetails(details: EmailDetail[]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;background:#f8f7fc;border:1px solid #ebe8f3;border-radius:16px;overflow:hidden">${details.map((detail, index) => `<tr><td style="padding:14px 16px;${index < details.length - 1 ? "border-bottom:1px solid #ebe8f3;" : ""}font-size:13px;line-height:20px;color:#6b6880;width:42%">${escapeHtml(detail.label)}</td><td align="right" style="padding:14px 16px;${index < details.length - 1 ? "border-bottom:1px solid #ebe8f3;" : ""}font-size:14px;line-height:20px;font-weight:700;color:#17142d">${escapeHtml(detail.value)}</td></tr>`).join("")}</table>`
}

export function renderEmailNotice(title: string, body: string, tone: "violet" | "green" | "amber" | "rose" = "violet") {
  const colors = {
    violet: { background: "#f5f3ff", border: "#ddd6fe", title: "#5b21b6", text: "#5b556f" },
    green: { background: "#ecfdf5", border: "#a7f3d0", title: "#047857", text: "#065f46" },
    amber: { background: "#fffbeb", border: "#fde68a", title: "#b45309", text: "#92400e" },
    rose: { background: "#fff1f2", border: "#fecdd3", title: "#be123c", text: "#9f1239" },
  }[tone]

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;background:${colors.background};border:1px solid ${colors.border};border-radius:16px"><tr><td style="padding:16px 18px"><p style="margin:0 0 5px;font-size:14px;line-height:20px;font-weight:800;color:${colors.title}">${escapeHtml(title)}</p><p style="margin:0;font-size:14px;line-height:22px;color:${colors.text}">${body}</p></td></tr></table>`
}

export function renderEmailActionLinks(actions: EmailCta[]) {
  return `<div style="margin-top:18px;text-align:center">${actions.map((action) => `<p style="margin:8px 0"><a href="${escapeHtml(safeUrl(action.href))}" style="color:#6d28d9;font-size:13px;font-weight:700;text-decoration:underline">${escapeHtml(action.label)} &nbsp;→</a></p>`).join("")}</div>`
}

export function renderCoreEmail({
  lang = "en",
  preheader,
  eyebrow,
  title,
  intro,
  content = "",
  cta,
  footerNote,
  accentColor = "#7c3aed",
}: EmailTemplateOptions) {
  const language = resolveLanguage(lang)
  const emailMessages = getEmailMessages(language)
  const rootUrl = `https://${getConfiguredRootDomain()}`
  const ctaUrl = cta ? safeUrl(cta.href) : ""
  const fallbackLabel = cta?.fallbackLabel || emailMessages.common.ctaFallback

  return `<!doctype html>
<html lang="${language}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(title)}</title>
    <style>
      @media only screen and (max-width:600px) {
        .email-shell { width:100% !important; }
        .email-pad { padding:20px 12px !important; }
        .email-card { border-radius:18px !important; }
        .email-content { padding:28px 20px !important; }
        .email-title { font-size:29px !important; line-height:35px !important; }
        .email-button { width:100% !important; }
        .email-button a { display:block !important; }
        .detail-label, .detail-value { display:block !important; width:100% !important; text-align:left !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f7f4ef;color:#17142d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#f7f4ef">
      <tr>
        <td class="email-pad" align="center" style="padding:36px 16px">
          <table class="email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;max-width:600px">
            <tr>
              <td style="padding:0 0 14px 4px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
                  <tr>
                    <td style="width:34px;height:34px;border-radius:11px;background:#17142d;color:#fff;text-align:center;vertical-align:middle;font-size:18px;font-weight:800;letter-spacing:-1px">S</td>
                    <td style="padding-left:10px;color:#17142d;font-size:13px;font-weight:800;letter-spacing:2px">${escapeHtml(PRODUCT_CONFIG.name.toUpperCase())}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-card" style="border:1px solid #e8e3dc;border-radius:24px;background:#ffffff;box-shadow:0 18px 48px rgba(23,20,45,.08);overflow:hidden">
                <div style="height:5px;background:${escapeHtml(accentColor)};font-size:0;line-height:0">&nbsp;</div>
                <div class="email-content" style="padding:38px 40px">
                  <p style="margin:0 0 14px;color:${escapeHtml(accentColor)};font-size:11px;line-height:16px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase">${escapeHtml(eyebrow)}</p>
                  <h1 class="email-title" style="margin:0;color:#17142d;font-size:34px;line-height:40px;letter-spacing:-.8px;font-weight:800">${escapeHtml(title)}</h1>
                  ${intro ? `<p style="margin:18px 0 0;color:#5f5b70;font-size:16px;line-height:26px">${intro}</p>` : ""}
                  ${content ? `<div style="margin-top:24px">${content}</div>` : ""}
                  ${cta ? `<table class="email-button" role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:30px auto 0;border-collapse:separate"><tr><td align="center" bgcolor="#17142d" style="border-radius:12px;box-shadow:0 8px 18px rgba(23,20,45,.18)"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:15px 24px;border:1px solid #17142d;border-radius:12px;color:#ffffff;font-size:15px;line-height:20px;font-weight:800;text-decoration:none">${escapeHtml(cta.label)} &nbsp;→</a></td></tr></table><p style="margin:22px 0 0;color:#8a8599;font-size:12px;line-height:19px;text-align:center">${escapeHtml(fallbackLabel)}<br><a href="${escapeHtml(ctaUrl)}" style="color:#6d28d9;word-break:break-all;text-decoration:underline">${escapeHtml(cta.href)}</a></p>` : ""}
                  ${footerNote ? `<p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #eeeaf2;color:#8a8599;font-size:12px;line-height:19px">${footerNote}</p>` : ""}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 8px 0;color:#928d9d;font-size:12px;line-height:19px;text-align:center">
                <p style="margin:0">${emailMessages.common.footer}</p>
                <p style="margin:4px 0 0"><a href="${escapeHtml(rootUrl)}" style="color:#6d28d9;text-decoration:underline">${escapeHtml(getConfiguredRootDomain())}</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
