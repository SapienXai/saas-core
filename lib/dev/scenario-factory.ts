import { createHash, randomBytes } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export const SCENARIO_KEYS = [
  "free-new",
  "free-99",
  "free-100",
  "starter-active",
  "pro-active",
  "pro-past-due",
  "business-multi",
  "unclaimed",
  "staff-restricted",
] as const

export type ScenarioKey = (typeof SCENARIO_KEYS)[number]

export type ScenarioUser = {
  id: string
  label: string
  email: string
  password: string
  role?: string
}

export type ScenarioManifest = {
  runId: string
  key: ScenarioKey
  createdAt: string
  users: ScenarioUser[]
  workspaceIds: string[]
  restaurantIds: string[]
  reservationIds: string[]
  customerManagementTokens: Array<{ reservationId: string; token: string }>
  primaryWorkspaceId: string | null
  primaryRestaurantId: string | null
  primaryRestaurantSlug: string | null
  publicUrls: string[]
}

type ScenarioClient = SupabaseClient<any, any, any>

const LOCAL_SUPABASE_URL = /^https?:\/\/(127\.0\.0\.1|localhost):54521$/
const DEFAULT_PASSWORD = "ReserveviaE2e!2026"

function assertScenarioEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ""
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  const enabled = process.env.RESERVEVIA_SCENARIOS_ENABLED === "1"
  const isProduction = process.env.NODE_ENV === "production"
  const paddleEnvironment = process.env.PADDLE_ENVIRONMENT ?? "sandbox"

  if (isProduction || !enabled || !LOCAL_SUPABASE_URL.test(url) || !serviceRoleKey || paddleEnvironment === "live") {
    throw new Error("Scenario seeder is restricted to an explicitly enabled local Supabase environment.")
  }

  return { url, serviceRoleKey }
}

function createServiceClient(): ScenarioClient {
  const { url, serviceRoleKey } = assertScenarioEnvironment()
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as ScenarioClient
}

function requireRow<T>(data: T | null | undefined, error: { message?: string } | null, message: string): T {
  if (error || !data) throw new Error(error?.message || message)
  return data
}

function createManifest(key: ScenarioKey, runId: string): ScenarioManifest {
  return {
    runId,
    key,
    createdAt: new Date().toISOString(),
    users: [],
    workspaceIds: [],
    restaurantIds: [],
    reservationIds: [],
    customerManagementTokens: [],
    primaryWorkspaceId: null,
    primaryRestaurantId: null,
    primaryRestaurantSlug: null,
    publicUrls: [],
  }
}

async function createUser(service: ScenarioClient, manifest: ScenarioManifest, label: string): Promise<ScenarioUser> {
  const email = `rv-${manifest.key}-${manifest.runId}-${label}@example.test`
  const created = await service.auth.admin.createUser({ email, password: DEFAULT_PASSWORD, email_confirm: true })
  const user = requireRow(created.data.user, created.error, "Could not create scenario user.")
  const scenarioUser = { id: user.id, label, email, password: DEFAULT_PASSWORD }
  manifest.users.push(scenarioUser)
  return scenarioUser
}

async function provisionRestaurant(
  service: ScenarioClient,
  manifest: ScenarioManifest,
  input: {
    name: string
    slug: string
    status?: "published" | "unpublished"
    claimStatus?: "claimed" | "unclaimed" | "claim_pending"
    ownerUserId?: string | null
    workspaceId?: string | null
    businessEmail?: string | null
    officialDomain?: string | null
  },
) {
  const result = await service.rpc("provision_restaurant_workspace", {
    target_restaurant_name: input.name,
    target_workspace_name: `${input.name} Workspace`,
    target_restaurant_slug: input.slug,
    target_workspace_id: input.workspaceId ?? null,
    target_owner_user_id: input.ownerUserId ?? null,
    target_restaurant_status: input.status ?? "published",
    target_claim_status: input.claimStatus ?? "claimed",
    target_source: input.claimStatus === "unclaimed" ? "platform_manual" : "self_service",
    target_business_contact_email: input.businessEmail ?? null,
    target_official_website_url: input.officialDomain ? `https://${input.officialDomain}` : null,
    target_official_domain: input.officialDomain ?? null,
    target_source_import_id: null,
    target_profile: {
      timezone: "UTC",
      language: "en",
      description: `${input.name} deterministic Reservevia scenario restaurant`,
      cuisine: "Mediterranean",
      location: "Scenario Test City",
      phone: "+1 555 010 2026",
      opening_time: "09:00",
      closing_time: "22:00",
      advance_booking_days: 30,
      min_advance_hours: 0,
      reservation_enabled: true,
    },
  } as any)
  const row = requireRow(result.data?.[0], result.error, "Could not provision scenario restaurant.") as {
    workspace_id: string
    restaurant_id: string
    restaurant_slug: string
  }
  if (!manifest.workspaceIds.includes(row.workspace_id)) manifest.workspaceIds.push(row.workspace_id)
  manifest.restaurantIds.push(row.restaurant_id)
  if (!manifest.primaryWorkspaceId) manifest.primaryWorkspaceId = row.workspace_id
  if (!manifest.primaryRestaurantId) {
    manifest.primaryRestaurantId = row.restaurant_id
    manifest.primaryRestaurantSlug = row.restaurant_slug
  }
  manifest.publicUrls.push(`/r/${row.restaurant_slug}`)
  return row
}

async function setSubscription(service: ScenarioClient, workspaceId: string, planKey: string, status = "active", extra: Record<string, unknown> = {}) {
  const { error } = await service
    .from("workspace_subscriptions")
    .update({ plan_key: planKey, status, source: planKey === "free" ? "free" : "manual", ...extra })
    .eq("workspace_id", workspaceId)
  if (error) throw new Error(`Could not set scenario subscription: ${error.message}`)
}

function futureReservationDate() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 7)
  return date.toISOString().slice(0, 10)
}

async function seedReservations(service: ScenarioClient, manifest: ScenarioManifest, restaurantId: string, count: number) {
  const rows = Array.from({ length: count }, (_, index) => ({
    restaurant_id: restaurantId,
    customer_name: `Scenario Guest ${index + 1}`,
    customer_phone: `+1555010${String(index + 1).padStart(4, "0")}`,
    customer_email: `scenario-guest-${manifest.runId}-${index + 1}@example.test`,
    party_size: 2,
    reservation_date: futureReservationDate(),
    reservation_time: `${String(12 + (index % 8)).padStart(2, "0")}:00:00`,
    special_requests: "Deterministic scenario reservation",
    status: "pending",
    reservation_type: "meal",
    booking_source: "online",
  }))
  for (const chunkStart of Array.from({ length: Math.ceil(rows.length / 25) }, (_, index) => index * 25)) {
    const chunk = rows.slice(chunkStart, chunkStart + 25)
    const inserted = await service.from("reservations").insert(chunk).select("id")
    if (inserted.error) throw new Error(`Could not seed scenario reservations: ${inserted.error.message}`)
    manifest.reservationIds.push(...((inserted.data ?? []) as Array<{ id: string }>).map((row) => row.id))
  }
}

async function seedCustomerManagementToken(service: ScenarioClient, manifest: ScenarioManifest, restaurantId: string, reservationId: string) {
  const raw = `rv_manage_${randomBytes(32).toString("base64url")}`
  const secret = process.env.RESERVEVIA_MANAGEMENT_TOKEN_SECRET || process.env.RESERVEVIA_RATE_LIMIT_SECRET || "reservevia-local-management-secret"
  const tokenHash = createHash("sha256").update(`${secret}:${raw}`).digest("hex")
  const { error } = await service.from("reservation_customer_management_tokens").insert({
    reservation_id: reservationId,
    restaurant_id: restaurantId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
  })
  if (error) throw new Error(`Could not seed customer management token: ${error.message}`)
  manifest.customerManagementTokens.push({ reservationId, token: raw })
}

async function addMember(service: ScenarioClient, workspaceId: string, userId: string, role: string, accessMode: "all" | "selected" = "all") {
  const result = await service
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role, restaurant_access_mode: accessMode })
    .select("id")
    .single()
  return requireRow(result.data, result.error, "Could not create scenario workspace member.") as { id: string }
}

async function addRestaurantAssignment(service: ScenarioClient, memberId: string, restaurantId: string) {
  const { error } = await service.from("workspace_member_restaurants").insert({ member_id: memberId, restaurant_id: restaurantId })
  if (error) throw new Error(`Could not create restaurant assignment: ${error.message}`)
}

async function createSecondaryWorkspace(service: ScenarioClient, manifest: ScenarioManifest, ownerUserId: string, runId: string) {
  const workspace = await service
    .from("workspaces")
    .insert({
      name: `Business Multi Workspace Two ${runId}`,
      slug: `business-multi-workspace-two-${runId}`,
      status: "active",
      created_by: null,
    })
    .select("id, slug")
    .single()
  const row = requireRow(workspace.data, workspace.error, "Could not create secondary scenario workspace.") as { id: string; slug: string }
  manifest.workspaceIds.push(row.id)
  await addMember(service, row.id, ownerUserId, "owner")
  return row
}

export async function seedScenario(key: ScenarioKey, options: { runId?: string } = {}): Promise<ScenarioManifest> {
  if (!SCENARIO_KEYS.includes(key)) throw new Error(`Unknown scenario: ${key}`)
  const service = createServiceClient()
  const runId = options.runId?.replace(/[^a-z0-9-]/gi, "-") || crypto.randomUUID().slice(0, 12)
  const manifest = createManifest(key, runId)

  try {
    const owner = await createUser(service, manifest, "owner")

    if (key === "unclaimed") {
      await provisionRestaurant(service, manifest, {
        name: `Unclaimed ${runId}`,
        slug: `unclaimed-${runId}`,
        claimStatus: "unclaimed",
        ownerUserId: null,
        businessEmail: owner.email,
        officialDomain: `unclaimed-${runId}.example.test`,
      })
      return manifest
    }

    const published = key !== "free-new"
    const primary = await provisionRestaurant(service, manifest, {
      name: `${key} Restaurant ${runId}`,
      slug: `${key}-${runId}`,
      status: published ? "published" : "unpublished",
      ownerUserId: owner.id,
    })

    if (published) {
      const { error } = await service
        .from("workspaces")
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq("id", primary.workspace_id)
      if (error) throw new Error(`Could not complete scenario onboarding state: ${error.message}`)
    }

    if (key === "free-99" || key === "free-100") {
      await seedReservations(service, manifest, primary.restaurant_id, key === "free-99" ? 99 : 100)
    }

    if (key === "starter-active") {
      const before = manifest.reservationIds.length
      await seedReservations(service, manifest, primary.restaurant_id, 1)
      const reservationId = manifest.reservationIds[before]
      if (reservationId) await seedCustomerManagementToken(service, manifest, primary.restaurant_id, reservationId)
    }

    if (key === "starter-active") await setSubscription(service, primary.workspace_id, "starter")
    if (key === "pro-active") await setSubscription(service, primary.workspace_id, "pro")
    if (key === "pro-past-due") {
      await setSubscription(service, primary.workspace_id, "pro", "past_due", {
        payment_failure_started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        payment_grace_ends_at: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString(),
        billing_issue_code: "past_due",
        provider_status: "past_due",
      })
    }

    if (key === "business-multi" || key === "staff-restricted") {
      await setSubscription(service, primary.workspace_id, "business")
      const second = await provisionRestaurant(service, manifest, {
        name: `${key} Second ${runId}`,
        slug: `${key}-second-${runId}`,
        workspaceId: primary.workspace_id,
      })
      if (key === "business-multi") {
        await provisionRestaurant(service, manifest, {
          name: `${key} Third ${runId}`,
          slug: `${key}-third-${runId}`,
          workspaceId: primary.workspace_id,
        })
        const secondaryWorkspace = await createSecondaryWorkspace(service, manifest, owner.id, runId)
        const secondary = await provisionRestaurant(service, manifest, {
          name: `${key} Workspace Two ${runId}`,
          slug: `${key}-workspace-two-${runId}`,
          workspaceId: secondaryWorkspace.id,
        })
        await setSubscription(service, secondary.workspace_id, "business")
        const { error: secondaryOnboardingError } = await service
          .from("workspaces")
          .update({ onboarding_completed_at: new Date().toISOString() })
          .eq("id", secondary.workspace_id)
        if (secondaryOnboardingError) throw secondaryOnboardingError
      } else {
        const manager = await createUser(service, manifest, "manager")
        const staff = await createUser(service, manifest, "staff")
        const managerMember = await addMember(service, primary.workspace_id, manager.id, "manager", "selected")
        const staffMember = await addMember(service, primary.workspace_id, staff.id, "staff", "selected")
        await addRestaurantAssignment(service, managerMember.id, second.restaurant_id)
        await addRestaurantAssignment(service, staffMember.id, primary.restaurant_id)
        manager.role = "manager"
        staff.role = "staff"
      }
    }

    return manifest
  } catch (error) {
    await destroyScenario(manifest).catch(() => undefined)
    throw error
  }
}

export async function destroyScenario(manifest: ScenarioManifest) {
  const service = createServiceClient()
  if (!manifest || !Array.isArray(manifest.workspaceIds) || !Array.isArray(manifest.users)) throw new Error("Invalid scenario manifest.")

  if (manifest.restaurantIds.length) await service.from("restaurants").delete().in("id", manifest.restaurantIds)
  if (manifest.workspaceIds.length) await service.from("workspaces").delete().in("id", manifest.workspaceIds)
  for (const user of manifest.users) await service.auth.admin.deleteUser(user.id)
}

export async function cleanupScenarioUser(userId: string) {
  const service = createServiceClient()
  const workspaces = await service.from("workspaces").select("id").eq("created_by", userId)
  if (workspaces.error) throw new Error(`Could not find scenario user workspaces: ${workspaces.error.message}`)
  const workspaceIds = (workspaces.data ?? []).map((row: { id: string }) => row.id)
  if (workspaceIds.length) await service.from("restaurants").delete().in("workspace_id", workspaceIds)
  if (workspaceIds.length) await service.from("workspaces").delete().in("id", workspaceIds)
  await service.auth.admin.deleteUser(userId)
}

export async function cleanupScenarioUserByEmail(email: string) {
  const service = createServiceClient()
  const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (users.error) throw new Error(`Could not find scenario user: ${users.error.message}`)
  const user = users.data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase())
  if (user) await cleanupScenarioUser(user.id)
}

export function getScenarioCredentials(manifest: ScenarioManifest, label = "owner") {
  const user = manifest.users.find((candidate) => candidate.label === label)
  if (!user) throw new Error(`Scenario user not found: ${label}`)
  return { email: user.email, password: user.password }
}
