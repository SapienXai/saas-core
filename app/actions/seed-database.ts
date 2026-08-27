"use server"

import { seedRestaurants } from "@/lib/seed-data"
import { getCurrentUserAccess } from "@/lib/auth-utils"

export async function seedDatabase() {
  const access = await getCurrentUserAccess()
  if (!access || access.platformRole !== "platform_owner") {
    return { success: false, message: "Forbidden" }
  }

  // Run seeding with strict service role client; return structured result for UI
  const result = await seedRestaurants()
  return result
}
