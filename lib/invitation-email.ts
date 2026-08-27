import "server-only"

import { getEmailMessages, interpolateEmail } from "@/i18n/email-messages"
import { formatDate } from "@/i18n/format"
import { resolveLanguage } from "@/i18n/config"
import { sendEmail } from "@/lib/email-service"
import { escapeHtml, renderEmailDetails, renderEmailNotice, renderReserveviaEmail } from "@/lib/email-template"
import { getInvitationUrl } from "@/lib/invitations"

export type WorkspaceInvitationEmailInput = {
  to: string
  token: string
  workspaceName: string
  inviterLabel: string
  role: string
  accessLabel: string
  expiresAt: string
  lang?: string
}

export function buildWorkspaceInvitationEmail(input: WorkspaceInvitationEmailInput) {
  const language = resolveLanguage(input.lang)
  const copy = getEmailMessages(language)
  const invitation = copy.invitation
  const workspaceName = escapeHtml(input.workspaceName)
  const inviterLabel = escapeHtml(input.inviterLabel)
  const acceptUrl = getInvitationUrl(input.token)
  const from = process.env.RESERVEVIA_SYSTEM_EMAIL_FROM?.trim() || "Reservevia <noreply@reservevia.com>"
  const expiresOn = formatDate(input.expiresAt, language, { dateStyle: "medium" })
  const htmlReplacements = {
    inviter: inviterLabel,
    workspace: workspaceName,
    email: escapeHtml(input.to),
    expires: escapeHtml(expiresOn),
  }
  const text = interpolateEmail(invitation.text, {
    inviterPlain: input.inviterLabel,
    workspacePlain: input.workspaceName,
    role: input.role,
    access: input.accessLabel,
    url: acceptUrl,
    expires: expiresOn,
  })

  return {
    to: input.to,
    from,
    replyTo: process.env.RESERVEVIA_SYSTEM_EMAIL_REPLY_TO?.trim() || "support@reservevia.com",
    subject: interpolateEmail(invitation.subject, { workspace: input.workspaceName }),
    text,
    html: renderReserveviaEmail({
      lang: language,
      preheader: interpolateEmail(invitation.preheader, { workspace: input.workspaceName }),
      eyebrow: invitation.eyebrow,
      title: invitation.title,
      intro: interpolateEmail(invitation.intro, htmlReplacements),
      content: `${renderEmailDetails([{ label: invitation.role, value: input.role }, { label: invitation.access, value: input.accessLabel }])}<div style="margin-top:18px">${renderEmailNotice(invitation.noticeTitle, interpolateEmail(invitation.notice, htmlReplacements), "violet")}</div>`,
      cta: { label: invitation.cta, href: acceptUrl },
      footerNote: invitation.footer,
    }),
  }
}

export async function sendWorkspaceInvitationEmail(input: WorkspaceInvitationEmailInput) {
  return sendEmail(buildWorkspaceInvitationEmail(input))
}
