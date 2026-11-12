import "server-only"

import { escapeHtml, type EmailDetail } from "@/lib/email-template"
import type { SupportedLanguage } from "@/i18n/config"

export type TransactionalEmailContent = {
  language: SupportedLanguage;
  subject: string;
  title: string;
  intro: string;
  note?: string;
  action?: { label: string; href: string };
  code?: string;
  details?: readonly EmailDetail[];
};

const defaultPalette = {
  canvas: "#f1f0f7",
  paper: "#ffffff",
  border: "#e2dfee",
  ink: "#201a32",
  muted: "#575168",
  accent: "#dbd1fb",
  inset: "#f2ecfc",
};

export type TransactionalEmailBrand = {
  name: string
  logoUrl: string
  palette?: Partial<{ [Key in keyof typeof defaultPalette]: `#${string}` }>
}

export type AccountEmailKind = "verify" | "reset"

export type AccountEmailMessage = Pick<TransactionalEmailContent, "subject" | "title" | "intro" | "note"> & {
  action: string
}

/** Product-supplied presentation only. Core owns the recipient, action URL and delivery. */
export type AccountEmailConfig = {
  palette?: TransactionalEmailBrand["palette"]
  messages: Readonly<Partial<Record<SupportedLanguage, Readonly<Partial<Record<AccountEmailKind, AccountEmailMessage>>>>>>
}

function color(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function actionLink(href: string) {
  const url = new URL(href);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Email action must use an HTTP or HTTPS URL without credentials.");
  }
  return href;
}

export function renderTransactionalEmail(
  { language, subject, title, intro, note, action, code, details = [] }: TransactionalEmailContent,
  branding: TransactionalEmailBrand,
) {
  const palette = {
    canvas: color(branding.palette?.canvas, defaultPalette.canvas),
    paper: color(branding.palette?.paper, defaultPalette.paper),
    border: color(branding.palette?.border, defaultPalette.border),
    ink: color(branding.palette?.ink, defaultPalette.ink),
    muted: color(branding.palette?.muted, defaultPalette.muted),
    accent: color(branding.palette?.accent, defaultPalette.accent),
    inset: color(branding.palette?.inset, defaultPalette.inset),
  }
  const brand = escapeHtml(branding.name);
  const logoUrl = escapeHtml(actionLink(branding.logoUrl));
  const actionHref = action ? actionLink(action.href) : undefined;
  const text = [title, intro, code, ...details.map(({ label, value }) => `${label}: ${value}`),
    action && `${action.label}: ${actionHref}`, note].filter(Boolean).join("\n\n");
  const html = `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .sc-email-outer { padding: 20px 12px !important; }
      .sc-email-inner { padding-left: 22px !important; padding-right: 22px !important; }
      .sc-email-title { font-size: 28px !important; line-height: 34px !important; }
      .sc-email-action { width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${palette.canvas};color:${palette.ink};font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(intro)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${palette.canvas}">
    <tr><td class="sc-email-outer" align="center" style="padding:42px 16px">
      <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${palette.paper}" style="max-width:560px;border:1px solid ${palette.border};border-radius:22px;border-collapse:separate;border-spacing:0;box-shadow:0 14px 36px rgba(24,15,32,.075)">
        <tr><td class="sc-email-inner" style="padding:30px 36px 25px;border-bottom:1px solid ${palette.border}">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td><img src="${logoUrl}" alt="" width="44" height="44" style="display:block;border:0;border-radius:11px"></td>
            <td style="padding-left:12px;color:${palette.ink};font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:26px;letter-spacing:-.5px;font-weight:700">${brand}</td>
          </tr></table>
        </td></tr>
        <tr><td class="sc-email-inner" style="padding:30px 36px 34px;font-family:Arial,Helvetica,sans-serif">
          <h1 class="sc-email-title" style="margin:0;color:${palette.ink};font-size:33px;line-height:40px;letter-spacing:-.8px;font-weight:700">${escapeHtml(title)}</h1>
          <p style="margin:12px 0 0;color:${palette.muted};font-size:16px;line-height:25px">${escapeHtml(intro)}</p>
          ${code ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px"><tr><td bgcolor="${palette.inset}" align="center" style="padding:19px 12px;border:1px solid ${palette.border};border-radius:12px;color:${palette.ink};font-family:Consolas,Menlo,monospace;font-size:30px;line-height:36px;font-weight:700;letter-spacing:5px">${escapeHtml(code)}</td></tr></table>` : ""}
          ${details.length ? `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;background-color:${palette.inset};border:1px solid ${palette.border};border-radius:12px;border-spacing:0">${details.map(({ label, value }) => `<tr><th scope="row" align="left" style="padding:12px;color:${palette.muted};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:400">${escapeHtml(label)}</th><td align="right" style="padding:12px;color:${palette.ink};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:700">${escapeHtml(value)}</td></tr>`).join("")}</table>` : ""}
          ${action && actionHref ? `<table class="sc-email-action" role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px"><tr><td align="center" bgcolor="${palette.accent}" style="border-radius:12px;mso-padding-alt:14px 22px"><a href="${escapeHtml(actionHref)}" style="display:block;padding:14px 22px;color:${palette.ink};font-size:15px;line-height:20px;font-family:Arial,Helvetica,sans-serif;font-weight:700;text-decoration:none;mso-padding-alt:0">${escapeHtml(action.label)}</a></td></tr></table>` : ""}
          ${note ? `<p style="margin:24px 0 0;padding-top:17px;border-top:1px solid ${palette.border};color:${palette.muted};font-size:13px;line-height:20px">${escapeHtml(note)}</p>` : ""}
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}
