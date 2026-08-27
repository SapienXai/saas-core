"use server"

import { seedRestaurants } from "@/lib/seed-data"
import { createServiceRoleClient } from "@/lib/supabase"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { revalidatePath } from "next/cache"

export async function initializeDatabase() {
  const access = await getCurrentUserAccess()
  if (process.env.NODE_ENV === "production" || access?.platformRole !== "platform_owner") {
    return { success: false, message: "Forbidden" }
  }

  try {
    await seedRestaurants()
    revalidatePath("/")
    return { success: true, message: "Database initialized successfully" }
  } catch (error) {
    console.error("Error initializing database:", error)
    return { success: false, message: "Failed to initialize database" }
  }
}

export async function createInitialAdminUser(email: string, password: string, fullName: string) {
  const access = await getCurrentUserAccess()
  if (process.env.NODE_ENV === "production" || access?.platformRole !== "platform_owner") {
    return { success: false, message: "Forbidden" }
  }
  if (!/^\S+@\S+\.\S+$/.test(email.trim()) || password.length < 8 || password.length > 128 || fullName.trim().length < 1 || fullName.trim().length > 120) {
    return { success: false, message: "Invalid administrator details." }
  }

  try {
    const supabase = createServiceRoleClient()

    // Create the user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      console.error("Error creating admin user:", authError)
      return { success: false, message: authError.message }
    }

    // Create the admin profile
    const { error: profileError } = await supabase.from("admin_profiles").insert({
      id: authData.user.id,
      full_name: fullName,
      role: "admin",
    })

    if (profileError) {
      console.error("Error creating admin profile:", profileError)
      return { success: false, message: profileError.message }
    }

    // After the workspace migration, keep new setup admins in the inherited
    // Felix workspace. Before that migration the compatibility query simply
    // returns a missing-table error and setup continues as before.
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id")
      .eq("slug", "felix-restaurants")
      .maybeSingle()
    if (workspace?.id) {
      const { error: membershipError } = await supabase
        .from("workspace_members")
        .upsert(
          { workspace_id: workspace.id, user_id: authData.user.id, role: "owner" },
          { onConflict: "workspace_id,user_id" },
        )
      if (membershipError) {
        console.error("Error creating initial workspace membership:", membershipError)
        return { success: false, message: "Admin created but workspace membership failed" }
      }
    }

    return { success: true, message: "Admin user created successfully" }
  } catch (error) {
    console.error("Error in createInitialAdminUser:", error)
    return { success: false, message: "An unexpected error occurred" }
  }
}
