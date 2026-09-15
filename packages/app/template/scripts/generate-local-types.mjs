import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"

const generated = execFileSync(
  "supabase",
  ["gen", "types", "--local", "--workdir", ".", "--schema", "public"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
)

// Supabase's type generator does not preserve nullability for RETURNS TABLE
// fields. This RPC deliberately returns NULL when a quota is unavailable or
// unlimited, so keep the checked-in contract honest and deterministic.
const normalizedGenerated = generated.replace(
  /(lock_workspace_entitlement:[\s\S]*?limit_value: )number(?: \| null)?(\r?\n)/,
  "$1number | null$2",
)
if (!normalizedGenerated.includes("limit_value: number | null")) throw new Error("lock_workspace_entitlement return type was not generated; review types/supabase.ts.")

const aliases = `

export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"]
export type WorkspaceMember = Database["public"]["Tables"]["workspace_members"]["Row"]
export type WorkspaceInvitation = Database["public"]["Tables"]["workspace_invitations"]["Row"]
export type Plan = Database["public"]["Tables"]["plans"]["Row"]
export type WorkspaceSubscription = Database["public"]["Tables"]["workspace_subscriptions"]["Row"]
export type WorkspaceUsagePeriod = Database["public"]["Tables"]["workspace_usage_periods"]["Row"]
export type WorkspaceDomain = Database["public"]["Tables"]["workspace_domains"]["Row"]
export type WorkspacePwaSettings = Database["public"]["Tables"]["workspace_pwa_settings"]["Row"]
export type WorkspacePushSubscription = Database["public"]["Tables"]["workspace_push_subscriptions"]["Row"]
export type PlatformMember = Database["public"]["Tables"]["platform_members"]["Row"]
export type PlatformAuditLog = Database["public"]["Tables"]["platform_audit_logs"]["Row"]
export type EmailDeliveryEvent = Database["public"]["Tables"]["email_delivery_events"]["Row"]
export type EmailOutboxRun = Database["public"]["Tables"]["email_outbox_runs"]["Row"]
`

mkdirSync("types", { recursive: true })
writeFileSync("types/supabase.ts", normalizedGenerated + aliases, "utf8")
console.log("Generated types/supabase.ts from the local SaaS Core schema.")
