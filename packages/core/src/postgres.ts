// Explicit server entry point. The portable Core entry never imports these dependencies.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto"
import { PostgrestClient } from "@supabase/postgrest-js"
export { betterAuth } from "better-auth"
export { admin } from "better-auth/plugins"
export { Pool } from "pg"

type DataIdentity = { role: "anon" | "authenticated" | "service_role"; id?: string; email?: string }

function dataSigningKey() {
  const pem = process.env.SAAS_CORE_DATA_SIGNING_KEY
  const audience = process.env.SAAS_CORE_DATA_AUDIENCE
  if (!pem || !audience) throw new Error("Configure the server-only data API signing key and audience.")
  const privateKey = createPrivateKey(pem.replace(/\\n/g, "\n"))
  if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error("The data API signing key must be RSA with at least 2048 bits.")
  }
  const publicKey = createPublicKey(privateKey)
  const kid = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64url")
  return { privateKey, publicKey, kid, audience }
}

export function getDataApiJwks() {
  const { publicKey, kid } = dataSigningKey()
  return { keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] }
}

export function createNeonDataClient(identity: DataIdentity) {
  const endpoint = process.env.NEON_DATA_API_URL
  if (!endpoint) throw new Error("NEON_DATA_API_URL is required in Neon mode.")
  const url = new URL(endpoint)
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new Error("Configure an HTTPS Neon Data API URL or a loopback development endpoint.")
  }
  if (identity.role === "authenticated" && !identity.id) throw new Error("Authenticated database calls require a verified user.")
  const { privateKey, kid, audience } = dataSigningKey()
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const fetchWithIdentity: typeof fetch = (input, init) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url)
    const base = url.pathname.replace(/\/$/, "")
    if (target.origin !== url.origin || !target.pathname.startsWith(base + "/")) {
      throw new Error("Data API credentials cannot be sent to another endpoint.")
    }
    const now = Math.floor(Date.now() / 1000)
    const jwt = encode({ alg: "RS256", typ: "JWT", kid }) + "." + encode({
      role: identity.role,
      sub: identity.id ?? "saas-core:" + identity.role,
      email: identity.email,
      aud: audience,
      iat: now,
      exp: now + 60,
    })
    const headers = new Headers(init?.headers)
    headers.set("Authorization", "Bearer " + jwt + "." + sign("RSA-SHA256", Buffer.from(jwt), privateKey).toString("base64url"))
    return fetch(input, { ...init, headers, redirect: "error", cache: "no-store" })
  }
  return new PostgrestClient(url.href.replace(/\/$/, ""), { fetch: fetchWithIdentity })
}
