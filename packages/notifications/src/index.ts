export type NotificationScope = { workspaceId: string; userId?: string }
export type EmailMessage = { to: string; subject: string; html: string; text?: string; scope: NotificationScope; idempotencyKey: string }
export type PushMessage = { title: string; body: string; url?: string; scope: NotificationScope; idempotencyKey: string }
export type NotificationProvider<T> = { send(message: T): Promise<{ id: string }> }
export type NotificationError = { provider: string; status: number | null; code: string; message: string; retryable: boolean }

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;")
}

export function buildInvitationEmail(input: { productName: string; workspaceName: string; role: string; invitationUrl: string; to: string }): EmailMessage {
  const productName = escapeHtml(input.productName)
  const workspaceName = escapeHtml(input.workspaceName)
  const role = escapeHtml(input.role)
  const invitationUrl = escapeHtml(input.invitationUrl)
  return {
    to: input.to,
    subject: `You are invited to join ${input.workspaceName}`,
    html: `<main style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;color:#101827"><p style="color:#315cf6;font-weight:700">${productName}</p><h1>Join ${workspaceName}</h1><p>You have been invited as a ${role}. The invitation is bound to ${escapeHtml(input.to)}.</p><p><a href="${invitationUrl}" style="display:inline-block;background:#315cf6;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Review invitation</a></p><p style="color:#637087;font-size:13px">This link expires according to the workspace invitation policy.</p></main>`,
    text: `Join ${input.workspaceName} on ${input.productName}\n\nYou have been invited as a ${input.role}. Review the invitation: ${input.invitationUrl}`,
    scope: { workspaceId: "invitation" },
    idempotencyKey: `invitation:${input.invitationUrl}`,
  }
}

export class ProviderNotificationError extends Error {
  readonly details: NotificationError
  constructor(details: NotificationError) { super(details.message); this.name = "ProviderNotificationError"; this.details = details }
}

export class ResendEmailProvider implements NotificationProvider<EmailMessage> {
  constructor(private readonly input: { apiKey: string; from: string; fetcher?: typeof fetch }) {}
  async send(message: EmailMessage) {
    const fetcher = this.input.fetcher ?? fetch
    const response = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${this.input.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: this.input.from, to: [message.to], subject: message.subject, html: message.html, text: message.text, headers: { "X-Idempotency-Key": message.idempotencyKey } }) })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new ProviderNotificationError({ provider: "resend", status: response.status, code: response.status === 429 ? "RATE_LIMITED" : "RESEND_REQUEST_FAILED", message: body || "Resend request failed.", retryable: response.status === 429 || response.status >= 500 })
    }
    const data = await response.json() as { id?: string }
    if (!data.id) throw new ProviderNotificationError({ provider: "resend", status: response.status, code: "RESEND_RESPONSE_INVALID", message: "Resend did not return a message ID.", retryable: false })
    return { id: data.id }
  }
}

export type WebPushSender = (message: PushMessage) => Promise<{ id: string }>

export function createWebPushProvider(sender: WebPushSender): NotificationProvider<PushMessage> {
  return { send: sender }
}

export type InvalidPushEndpointHandler = (message: PushMessage, error: unknown) => Promise<void> | void
export function createResilientWebPushProvider(sender: WebPushSender, onInvalidEndpoint?: InvalidPushEndpointHandler): NotificationProvider<PushMessage> {
  return { async send(message) { try { return await sender(message) } catch (error) { if (onInvalidEndpoint && (error instanceof ProviderNotificationError ? error.details.code === "PUSH_ENDPOINT_GONE" : false)) await onInvalidEndpoint(message, error); throw error } } }
}

export async function sendWithRetry<T>(provider: NotificationProvider<T>, message: T, options: { attempts?: number; delayMs?: number; onFailure?: (error: unknown, attempt: number) => void } = {}) {
  const attempts = Math.max(1, options.attempts ?? 3)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await provider.send(message) } catch (error) { options.onFailure?.(error, attempt); if (attempt === attempts) throw error; await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 100 * attempt)) }
  }
  throw new Error("Notification delivery failed.")
}

export async function deliverBestEffort<T>(provider: NotificationProvider<T>, message: T, log: (event: { operation: string; error: unknown }) => void, operation: string) {
  try { return await provider.send(message) } catch (error) { log({ operation, error }); return null }
}
