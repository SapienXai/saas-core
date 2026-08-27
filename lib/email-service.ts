import { Resend } from "resend"

const DEFAULT_FROM = "Reservevia <noreply@reservevia.com>"
const DEFAULT_REPLY_TO = "support@reservevia.com"
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

export async function sendEmail({
  to,
  subject,
  html,
  text,
  from = process.env.RESERVEVIA_SYSTEM_EMAIL_FROM || DEFAULT_FROM,
  replyTo = process.env.RESERVEVIA_SYSTEM_EMAIL_REPLY_TO || DEFAULT_REPLY_TO,
  attachments = [],
  idempotencyKey,
}: SendEmailParams) {
  try {
    if (!process.env.RESEND_API_KEY) {
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
