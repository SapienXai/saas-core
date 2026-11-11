import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"
import { betterAuth, admin, Pool } from "@sapienx/saas-core/postgres"
import { sendEmail } from "@/lib/email-service"
import { getTrustedPlatformOrigin } from "@/lib/domains/hostname"

let pool: Pool | undefined
let instance: ReturnType<typeof makeAuth> | undefined
const captureRecovery = new AsyncLocalStorage<(url: string) => void>()

export function neonPool() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is required in Neon mode.")
  return pool ??= new Pool({ connectionString, options: "-c search_path=auth,public", max: 4, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 })
}

export function neonAuthOrigin() {
  return new URL(process.env.SAAS_CORE_AUTH_URL || getTrustedPlatformOrigin("app")).origin
}

async function deliverAuthEmail(to: string, subject: string, url: string) {
  const result = await sendEmail({ to, subject, text: url, html: "" })
  if (!result.success) throw new Error("Could not deliver the authentication email.")
}

function makeAuth() {
  const secret = process.env.SAAS_CORE_AUTH_SECRET
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("SAAS_CORE_AUTH_SECRET must contain at least 32 bytes.")
  const googleId = process.env.SAAS_CORE_GOOGLE_CLIENT_ID
  const googleSecret = process.env.SAAS_CORE_GOOGLE_CLIENT_SECRET
  return betterAuth({
    baseURL: neonAuthOrigin(),
    basePath: "/api/core-auth",
    secret,
    database: neonPool(),
    advanced: { cookiePrefix: "saas-core", database: { generateId: "uuid" } },
    user: { modelName: "users" },
    account: { modelName: "accounts" },
    session: { modelName: "sessions" },
    verification: { modelName: "verifications" },
    plugins: [admin()],
    socialProviders: googleId && googleSecret ? { google: { clientId: googleId, clientSecret: googleSecret } } : {},
    rateLimit: { enabled: true, storage: "database", modelName: "rate_limits" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await neonPool().query('UPDATE auth.users SET "emailVerified" = true WHERE id = $1', [user.id])
      },
      sendResetPassword: async ({ user, url }) => {
        const capture = captureRecovery.getStore()
        if (capture) capture(url)
        else await deliverAuthEmail(user.email, "Reset your password", url)
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user, url }) => deliverAuthEmail(user.email, "Verify your email address", url),
    },
  })
}

export function getNeonAuth() {
  return instance ??= makeAuth()
}

export function neonUser(user: { id: string; name: string; email: string; emailVerified: boolean; createdAt: Date | string }) {
  const created = new Date(user.createdAt).toISOString()
  return {
    id: user.id, email: user.email, created_at: created,
    email_confirmed_at: user.emailVerified ? created : undefined,
    confirmed_at: user.emailVerified ? created : undefined,
    user_metadata: { full_name: user.name }, app_metadata: {}, aud: "authenticated",
  }
}

export async function createNeonRecoveryLink(email: string) {
  let link: string | undefined
  await captureRecovery.run((url) => { link = url }, () => getNeonAuth().api.requestPasswordReset({
    body: { email, redirectTo: neonAuthOrigin() + "/reset-password" },
  }))
  return link
}

export function neonAuthPost(request: Request, path: string, body: object = {}) {
  const headers = new Headers(request.headers)
  headers.set("content-type", "application/json")
  headers.delete("content-length")
  return getNeonAuth().handler(new Request(neonAuthOrigin() + "/api/core-auth/" + path, {
    method: "POST", headers, body: JSON.stringify(body),
  }))
}

export function copyAuthCookies(source: Response, target: Response) {
  for (const cookie of source.headers.getSetCookie()) target.headers.append("set-cookie", cookie)
  target.headers.set("Cache-Control", "no-store")
  return target
}
