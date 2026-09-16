import { Resend } from "resend"

const DEFAULT_FROM = "SaaS Core <noreply@example.com>"
const DEFAULT_REPLY_TO = "support@example.com"
export const MANAGEMENT_EMAIL = process.env.MANAGEMENT_EMAIL || "ops@example.com"

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  attachments?: Array<{
    filename: string
    content: string
  }>
  idempotencyKey?: string
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY
  return apiKey ? new Resend(apiKey) : null
}

function parseMailpitAddress(value: string) {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/)
  if (!match) return { Email: value.trim() }
  const name = match[1].trim()
  return name ? { Email: match[2].trim(), Name: name } : { Email: match[2].trim() }
}

function getDevMailpitApiUrl() {
  if (process.env.NODE_ENV === "production") return null
  const configured = process.env.SAAS_CORE_MAIL_URL?.trim() || process.env.NEXT_PUBLIC_DEV_MAILPIT_URL?.trim()
  const origin = configured || `http://127.0.0.1:${process.env.SAAS_CORE_MAILPIT_PORT?.trim() || "55624"}`
  try {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v1/send`
    url.search = ""
    return url.toString()
  } catch {
    return null
  }
}

async function sendToDevMailpit({ to, subject, html, text, from, replyTo }: SendEmailParams) {
  const apiUrl = getDevMailpitApiUrl()
  if (!apiUrl) return null

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: parseMailpitAddress(from || DEFAULT_FROM),
        To: [parseMailpitAddress(to)],
        ReplyTo: [parseMailpitAddress(replyTo || DEFAULT_REPLY_TO)],
        Subject: subject,
        Text: text || "",
        HTML: html,
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      return { success: false as const, error: { message: `Local Mailpit rejected the message (${response.status}).${detail ? ` ${detail}` : ""}`, code: "dev_mailpit_send_failed" } }
    }
    const data = await response.json().catch(() => null)
    return { success: true as const, data, devMailpit: true as const }
  } catch (error) {
    console.error("[Email Service] Local Mailpit delivery failed:", error)
    return { success: false as const, error: { message: error instanceof Error ? error.message : "Local Mailpit is unavailable.", code: "dev_mailpit_unavailable" } }
  }
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  from = process.env.SAAS_CORE_SYSTEM_EMAIL_FROM || DEFAULT_FROM,
  replyTo = process.env.SAAS_CORE_SYSTEM_EMAIL_REPLY_TO || DEFAULT_REPLY_TO,
  attachments = [],
  idempotencyKey,
}: SendEmailParams) {
  try {
    if (!process.env.RESEND_API_KEY) {
      const devMailpit = await sendToDevMailpit({ to, subject, html, text, from, replyTo })
      if (devMailpit) return devMailpit
      console.warn("[Email Service] Resend API key is missing. Email sending is disabled.")
      return {
        success: false,
        error: { message: "Email sending is disabled because the Resend API key is missing.", code: "missing_api_key" },
        emailDisabled: true,
      }
    }

    const resend = getResendClient()
    if (!resend) {
      return {
        success: false,
        error: { message: "Email sending is disabled because the Resend API key is missing.", code: "missing_api_key" },
        emailDisabled: true,
      }
    }

    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      replyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
    }, idempotencyKey ? { idempotencyKey } : undefined)

    if (error) {
      console.error("[Email Service] Error sending email:", error)
      return { success: false, error }
    }

    console.log("[Email Service] Email sent successfully.")
    return { success: true, data }
  } catch (error) {
    console.error("[Email Service] Error in sendEmail:", error)
    return { success: false, error }
  }
}
