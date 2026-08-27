import webpush, { type PushSubscription } from "web-push"
import { createServiceRoleClient } from "@/lib/supabase"
function clean(value: string | undefined) { return value?.trim().replace(/^['"]|['"]$/g, "") || undefined }
function config() { const publicKey = clean(process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY); const privateKey = clean(process.env.WEB_PUSH_PRIVATE_KEY); if (!publicKey || !privateKey) return null; return { publicKey, privateKey, subject: clean(process.env.WEB_PUSH_SUBJECT) || "mailto:support@example.com" } }
export function getWebPushPublicKey() { return clean(process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY) || null }
export function isWebPushConfigured() { return Boolean(config()) }
export async function sendWorkspacePushNotification(input: { workspaceId: string; title: string; body: string; url?: string; data?: Record<string, unknown> }) {
  const settings = config(); if (!settings) return { sent: 0, skipped: true }
  webpush.setVapidDetails(settings.subject, settings.publicKey, settings.privateKey); const service = createServiceRoleClient() as any
  const { data: subscriptions } = await service.from("workspace_push_subscriptions").select("id, endpoint, p256dh, auth").eq("workspace_id", input.workspaceId).eq("status", "active")
  let sent = 0
  await Promise.all((subscriptions || []).map(async (row: any) => { const subscription: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }; try { await webpush.sendNotification(subscription, JSON.stringify({ title: input.title, body: input.body, url: input.url || "/app", data: input.data || {} })); sent += 1 } catch (error: any) { if ([404, 410].includes(error?.statusCode)) await service.from("workspace_push_subscriptions").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", row.id) } }))
  return { sent, skipped: false }
}
