import { createHash, randomBytes } from "node:crypto"
import { chmodSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const DATAENGINE_SCOPE = "dataengine:reservevia:write"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function usage() {
  console.log(`ReserveVia DataEngine credential provisioning (server-side only)

Required environment:
  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY
  RESERVEVIA_API_CREDENTIAL_PEPPER

Commands:
  pnpm dataengine:credential -- issue --name dataengine-production --actor-user-id <uuid> --reason "..."
  pnpm dataengine:credential -- rotate --revoke-client-id <uuid> --name dataengine-production --actor-user-id <uuid> --reason "..."
  pnpm dataengine:credential -- revoke --client-id <uuid> --actor-user-id <uuid> --reason "..."

The raw credential is printed once only. Never paste it into a ticket, CI log, shell history, or source file.`)
}

function value(args, flag, required = true) {
  const index = args.indexOf(flag)
  const result = index >= 0 ? args[index + 1] : undefined
  if (required && (!result || result.startsWith("--"))) throw new Error(`${flag} is required.`)
  return result
}

function requireUuid(value, label) {
  if (!value || !UUID_PATTERN.test(value)) throw new Error(`${label} must be a valid user/client UUID.`)
  return value
}

function requireReason(value) {
  const reason = value?.trim()
  if (!reason || reason.length < 8 || reason.length > 500) throw new Error("--reason must be between 8 and 500 characters.")
  return reason
}

function getContext(args) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const pepper = process.env.RESERVEVIA_API_CREDENTIAL_PEPPER
  if (!url || !serviceRoleKey || !pepper) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and RESERVEVIA_API_CREDENTIAL_PEPPER are required.")
  const actorUserId = requireUuid(value(args, "--actor-user-id"), "--actor-user-id")
  const reason = requireReason(value(args, "--reason"))
  return { service: createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }), pepper, actorUserId, reason }
}

function createRawCredential() {
  return `rv_live_${randomBytes(32).toString("base64url")}`
}

function hashCredential(raw, pepper) {
  return createHash("sha256").update(`${pepper}:${raw}`).digest("hex")
}

async function audit(service, input) {
  const { error } = await service.from("platform_audit_logs").insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: "api_client",
    entity_id: input.entityId || null,
    before_data: input.before || {},
    after_data: input.after || {},
    reason: input.reason,
    metadata: { source: "dataengine_credential_cli", scope: DATAENGINE_SCOPE, ...input.metadata },
  })
  if (error) throw new Error(`Credential audit could not be written: ${error.message}`)
}

async function createCredential(context, name) {
  const raw = createRawCredential()
  const { data, error } = await context.service.from("api_clients").insert({
    name,
    credential_hash: hashCredential(raw, context.pepper),
    scopes: [DATAENGINE_SCOPE],
    rate_limit_profile: "internal",
    status: "active",
  }).select("id, name, scopes, rate_limit_profile, created_at").single()
  if (error || !data) throw new Error(`Credential could not be created: ${error?.message || "unknown database error"}`)
  return { data, raw }
}

function validateName(name) {
  const trimmed = name?.trim()
  if (!trimmed || trimmed.length > 120) throw new Error("--name must be between 1 and 120 characters.")
  return trimmed
}

function deliverSecret(raw, secretFile) {
  if (secretFile) {
    writeFileSync(secretFile, `${raw}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 })
    chmodSync(secretFile, 0o600)
    console.log(`Credential created. Raw secret was written once to ${secretFile} (mode 0600).`)
    return
  }
  console.log("Credential created. Store this raw secret now; it will not be shown again:")
  console.log(raw)
}

async function issue(args) {
  const context = getContext(args)
  const created = await createCredential(context, validateName(value(args, "--name")))
  try {
    await audit(context.service, { actorUserId: context.actorUserId, action: "platform.api_client.issued", entityId: created.data.id, reason: context.reason, after: { name: created.data.name, scopes: created.data.scopes, rateLimitProfile: created.data.rate_limit_profile }, metadata: { credentialReturnedOnce: true } })
  } catch (error) {
    await context.service.from("api_clients").update({ status: "revoked" }).eq("id", created.data.id).eq("status", "active")
    throw error
  }
  deliverSecret(created.raw, value(args, "--secret-file", false))
}

async function rotate(args) {
  const context = getContext(args)
  const oldClientId = requireUuid(value(args, "--revoke-client-id"), "--revoke-client-id")
  const name = validateName(value(args, "--name"))
  const oldResult = await context.service.from("api_clients").select("id, name, scopes, status, rate_limit_profile").eq("id", oldClientId).maybeSingle()
  if (oldResult.error || !oldResult.data) throw new Error(`Existing credential could not be found: ${oldResult.error?.message || "not found"}`)
  if (oldResult.data.status !== "active") throw new Error("The credential to rotate is not active.")
  const created = await createCredential(context, name)
  try {
    await audit(context.service, { actorUserId: context.actorUserId, action: "platform.api_client.rotated", entityId: created.data.id, reason: context.reason, before: { revokedClientId: oldClientId, oldStatus: oldResult.data.status }, after: { name: created.data.name, scopes: created.data.scopes, rateLimitProfile: created.data.rate_limit_profile }, metadata: { replacedClientId: oldClientId, credentialReturnedOnce: true } })
  } catch (error) {
    await context.service.from("api_clients").update({ status: "revoked" }).eq("id", created.data.id).eq("status", "active")
    throw error
  }
  const revokeResult = await context.service.from("api_clients").update({ status: "revoked" }).eq("id", oldClientId).eq("status", "active")
  if (revokeResult.error) {
    console.error("New credential is active, but the old credential could not be revoked. Revoke the old client before enabling export.")
    throw new Error(`Old credential revocation failed: ${revokeResult.error.message}`)
  }
  await audit(context.service, { actorUserId: context.actorUserId, action: "platform.api_client.revoked", entityId: oldClientId, reason: context.reason, before: { status: "active" }, after: { status: "revoked" }, metadata: { replacementClientId: created.data.id, rotation: true } })
  deliverSecret(created.raw, value(args, "--secret-file", false))
}

async function revoke(args) {
  const context = getContext(args)
  const clientId = requireUuid(value(args, "--client-id"), "--client-id")
  const result = await context.service.from("api_clients").select("id, name, scopes, status, rate_limit_profile").eq("id", clientId).maybeSingle()
  if (result.error || !result.data) throw new Error(`Credential could not be found: ${result.error?.message || "not found"}`)
  if (result.data.status === "revoked") {
    console.log("Credential is already revoked; no mutation or duplicate audit was created.")
    return
  }
  const update = await context.service.from("api_clients").update({ status: "revoked" }).eq("id", clientId).eq("status", "active")
  if (update.error) throw new Error(`Credential could not be revoked: ${update.error.message}`)
  try {
    await audit(context.service, { actorUserId: context.actorUserId, action: "platform.api_client.revoked", entityId: clientId, reason: context.reason, before: { status: "active", name: result.data.name, scopes: result.data.scopes }, after: { status: "revoked" } })
  } catch (error) {
    await context.service.from("api_clients").update({ status: "active" }).eq("id", clientId).eq("status", "revoked")
    throw error
  }
  console.log("Credential revoked.")
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === "--") args.shift()
  const command = args[0]
  if (!command || command === "help" || command === "--help") return usage()
  if (!["issue", "rotate", "revoke"].includes(command)) throw new Error("Command must be issue, rotate, or revoke.")
  if (command === "issue") return issue(args)
  if (command === "rotate") return rotate(args)
  return revoke(args)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Credential command failed.")
  process.exitCode = 1
})
