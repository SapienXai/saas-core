import { execFileSync } from "node:child_process"
import { createClient } from "@supabase/supabase-js"

const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], { encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } }))
const appUrl = process.env.RESERVEVIA_APP_URL || "http://localhost:3000"
const mailUrl = process.env.RESERVEVIA_MAIL_URL || status.INBUCKET_URL || "http://127.0.0.1:54524"

if (!/^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(status.API_URL || "")) {
  throw new Error("Refusing auth E2E: local Reservevia Supabase is not running on port 54521.")
}

const anon = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const email = `reservevia-auth-e2e-${Date.now()}@example.test`
const password = "ReserveviaAuthE2E!2026"
let userId = ""
let workspaceId = ""

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForMail(subject) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${mailUrl}/api/v1/messages`)
    const inbox = await response.json()
    const message = inbox.messages?.find((candidate) =>
      candidate.Subject === subject && candidate.To?.some((recipient) => recipient.Address === email),
    )
    if (message) return fetch(`${mailUrl}/api/v1/message/${message.ID}`).then((result) => result.json())
    await sleep(250)
  }
  throw new Error(`Local Mailpit did not receive ${subject}.`)
}

function extractConfirmationUrl(message) {
  const match = message.HTML?.match(/href="([^"]*\/auth\/confirm[^"]*)"/)
  if (!match) throw new Error("Local auth message did not contain a Reservevia confirmation URL.")
  return match[1].replaceAll("&amp;", "&")
}

function extractSessionCookie(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""]
  const pair = values.map((value) => value.split(";", 1)[0]).find((value) => value.startsWith("sb-"))
  if (!pair) throw new Error("Reservevia confirmation did not return an SSR session cookie.")

  let encoded = decodeURIComponent(pair.slice(pair.indexOf("=") + 1))
  if (encoded.startsWith("base64-")) encoded = encoded.slice(7)
  const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  if (!session.access_token || !session.refresh_token) throw new Error("Reservevia SSR session cookie was incomplete.")
  return { cookie: pair, session }
}

try {
  const signup = await anon.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${appUrl}/auth/confirm?next=/onboarding` },
  })
  if (signup.error || !signup.data.user || signup.data.session) throw signup.error || new Error("Signup did not require confirmation.")
  userId = signup.data.user.id

  const confirmationMessage = await waitForMail("Confirm your Reservevia email")
  const confirmation = await fetch(extractConfirmationUrl(confirmationMessage), { redirect: "manual" })
  const { cookie, session } = extractSessionCookie(confirmation.headers)
  const onboardingLocation = new URL(confirmation.headers.get("location"), appUrl)
  const onboarding = await fetch(onboardingLocation, { headers: { cookie } })
  if (confirmation.status !== 307 || onboarding.status !== 200 || onboardingLocation.pathname !== "/onboarding") {
    throw new Error(`Confirmation did not lead to the onboarding page (confirmation=${confirmation.status} ${confirmation.headers.get("location") || ""}; onboarding=${onboarding.status} ${onboarding.url})`)
  }

  const authenticated = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const sessionResult = await authenticated.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
  if (sessionResult.error) throw sessionResult.error

  const restaurantName = `Auth E2E ${Date.now()}`
  const restaurantSlug = `auth-e2e-${Date.now()}`
  const bootstrap = await authenticated.rpc("bootstrap_initial_workspace", {
    target_restaurant_name: restaurantName,
    target_workspace_name: restaurantName,
    target_restaurant_slug: restaurantSlug,
  })
  if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Authenticated bootstrap failed.")
  workspaceId = bootstrap.data[0].workspace_id

  const [restaurant, subscription] = await Promise.all([
    authenticated.from("restaurants").select("id, workspace_id, name, slug, status").eq("id", bootstrap.data[0].restaurant_id).single(),
    authenticated.from("workspace_subscriptions").select("plan_key, source").eq("workspace_id", workspaceId).single(),
  ])
  if (restaurant.error || subscription.error || restaurant.data?.status !== "unpublished" || subscription.data?.plan_key !== "free") {
    throw new Error("Bootstrap did not create the expected unpublished restaurant and Free subscription.")
  }

  const reservationDate = new Date()
  reservationDate.setUTCDate(reservationDate.getUTCDate() + 1)
  const reservation = await authenticated.from("reservations").insert({
    restaurant_id: restaurant.data.id,
    reservation_area_id: null,
    customer_name: "Auth E2E Guest",
    customer_phone: "+10000000001",
    customer_email: email,
    party_size: 2,
    reservation_date: reservationDate.toISOString().slice(0, 10),
    reservation_time: "18:00:00",
    reservation_type: "meal",
    status: "pending",
    booking_source: "online",
  }).select("id").single()
  if (reservation.error || !reservation.data) throw reservation.error || new Error("Authenticated reservation creation failed.")

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  const usage = await authenticated.from("workspace_usage_periods").select("reservations_created").eq("workspace_id", workspaceId).eq("period_start", monthStart.toISOString().slice(0, 10)).single()
  if (usage.error || usage.data?.reservations_created !== 1) throw usage.error || new Error("Free usage did not become 1/100 after the first reservation.")

  await sleep(1100)
  const recoveryRequest = await authenticated.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/auth/confirm?next=/reset-password` })
  if (recoveryRequest.error) throw recoveryRequest.error
  const recoveryMessage = await waitForMail("Reset your Reservevia password")
  const recovery = await fetch(extractConfirmationUrl(recoveryMessage), { redirect: "manual" })
  const recoveryLocation = recovery.headers.get("location") ? new URL(recovery.headers.get("location"), appUrl).pathname : null

  console.log(JSON.stringify({
    signup: "passed",
    confirmationEmail: "passed",
    confirmationCallback: confirmation.status === 307 && onboardingLocation.pathname === "/onboarding" ? "passed" : "failed",
    authenticatedBootstrap: "passed",
    freeSubscription: subscription.data,
    restaurant: restaurant.data,
    firstReservation: "passed",
    freeUsage: "1/100",
    passwordRecovery: recovery.status === 307 && recoveryLocation === "/reset-password" ? "passed" : "failed",
  }))
} finally {
  if (workspaceId) await service.from("workspaces").delete().eq("id", workspaceId)
  if (userId) await service.auth.admin.deleteUser(userId)
}
