import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"

const generated = execFileSync(
  "supabase",
  ["gen", "types", "--local", "--workdir", ".", "--schema", "public"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
)

const compatibilityAliases = `

// Compatibility aliases used by the existing management components. The
// underlying table definitions are generated from the local Reservevia
// schema by \`npm run db:types\`.
export type Restaurant = Database["public"]["Tables"]["restaurants"]["Row"]
export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"]
export type WorkspaceMember = Database["public"]["Tables"]["workspace_members"]["Row"]
export type RestaurantMedia = Database["public"]["Tables"]["restaurant_media"]["Row"]
export type ReservationArea = Database["public"]["Tables"]["reservation_areas"]["Row"]
export type Reservation = Database["public"]["Tables"]["reservations"]["Row"]
export type AdminProfile = Database["public"]["Tables"]["admin_profiles"]["Row"]
export type AdminPushSubscription = Database["public"]["Tables"]["admin_push_subscriptions"]["Row"]
export type NotificationSettings = Database["public"]["Tables"]["notification_settings"]["Row"]
export type Plan = Database["public"]["Tables"]["plans"]["Row"]
export type WorkspaceSubscription = Database["public"]["Tables"]["workspace_subscriptions"]["Row"]
export type WorkspaceUsagePeriod = Database["public"]["Tables"]["workspace_usage_periods"]["Row"]
export type RestaurantDomain = Database["public"]["Tables"]["restaurant_domains"]["Row"]
export type WorkspacePwaSettings = Database["public"]["Tables"]["workspace_pwa_settings"]["Row"]
export type WorkspacePushSubscription = Database["public"]["Tables"]["workspace_push_subscriptions"]["Row"]
export type PlatformUserDirectory = Database["public"]["Tables"]["platform_user_directory"]["Row"]
export type DataEngineImportBatch = Database["public"]["Tables"]["dataengine_import_batches"]["Row"]
export type DataEngineImportLead = Database["public"]["Tables"]["dataengine_import_leads"]["Row"]
export type DataEngineImportEvidence = Database["public"]["Tables"]["dataengine_import_evidence"]["Row"]
export type EmailDeliveryEvent = Database["public"]["Tables"]["email_delivery_events"]["Row"]
export type EmailOutboxRun = Database["public"]["Tables"]["email_outbox_runs"]["Row"]
`

mkdirSync("types", { recursive: true })
writeFileSync("types/supabase.ts", generated + compatibilityAliases, "utf8")
console.log("Generated types/supabase.ts from the local Reservevia Supabase schema.")
