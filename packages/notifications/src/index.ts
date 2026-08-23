export type NotificationScope = { workspaceId: string; userId?: string }
export type EmailMessage = { to: string; subject: string; html: string; text?: string; scope: NotificationScope; idempotencyKey: string }
export type PushMessage = { title: string; body: string; url?: string; scope: NotificationScope; idempotencyKey: string }
export type NotificationProvider<T> = { send(message: T): Promise<{ id: string }> }

export class ResendEmailProvider implements NotificationProvider<EmailMessage> {
  constructor(private readonly input: { apiKey: string; from: string; fetcher?: typeof fetch }) {}
  async send(message: EmailMessage) {
    const fetcher = this.input.fetcher ?? fetch
    const response = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${this.input.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: this.input.from, to: [message.to], subject: message.subject, html: message.html, text: message.text, headers: { "X-Idempotency-Key": message.idempotencyKey } }) })
    if (!response.ok) throw new Error("Email provider request failed")
    return response.json() as Promise<{ id: string }>
  }
}

export type WebPushSender = (message: PushMessage) => Promise<{ id: string }>

export function createWebPushProvider(sender: WebPushSender): NotificationProvider<PushMessage> {
  return { send: sender }
}

export async function deliverBestEffort<T>(provider: NotificationProvider<T>, message: T, log: (event: { operation: string; error: unknown }) => void, operation: string) {
  try { return await provider.send(message) } catch (error) { log({ operation, error }); return null }
}
