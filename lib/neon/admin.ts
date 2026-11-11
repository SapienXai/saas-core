import "server-only"

import { randomBytes } from "node:crypto"
import { createNeonRecoveryLink, getNeonAuth, neonAuthOrigin, neonPool, neonUser } from "./auth"

type StoredUser = Parameters<typeof neonUser>[0]
type UserInput = { email: string; password: string; email_confirm?: boolean; user_metadata?: { full_name?: string } }
const fields = 'id, email, name, "createdAt", "emailVerified"'

function authError() {
  return new Error("The authentication operation could not be completed.")
}

export const neonAuthAdmin = {
  async listUsers({ page = 1, perPage = 1000 } = {}) {
    try {
      const limit = Math.max(1, Math.min(1000, perPage))
      const result = await neonPool().query<StoredUser>(`SELECT ${fields} FROM auth.users ORDER BY "createdAt", id LIMIT $1 OFFSET $2`, [limit, Math.max(0, page - 1) * limit])
      return { data: { users: result.rows.map(neonUser) }, error: null }
    } catch {
      return { data: { users: [] }, error: authError() }
    }
  },
  async getUserById(id: string) {
    try {
      const { rows: [row] } = await neonPool().query<StoredUser>(`SELECT ${fields} FROM auth.users WHERE id = $1`, [id])
      return { data: { user: row ? neonUser(row) : null }, error: row ? null : authError() }
    } catch {
      return { data: { user: null }, error: authError() }
    }
  },
  async createUser(input: UserInput) {
    let id: string | undefined
    try {
      const { user } = await getNeonAuth().api.createUser({
        body: { email: input.email, password: input.password, name: input.user_metadata?.full_name || input.email, role: "user" },
      })
      id = user.id
      if (input.email_confirm) {
        const { rows: [row] } = await neonPool().query<StoredUser>(`UPDATE auth.users SET "emailVerified" = true WHERE id = $1 RETURNING ${fields}`, [id])
        return { data: { user: neonUser(row) }, error: null }
      }
      return { data: { user: neonUser(user) }, error: null }
    } catch {
      if (id) await neonAuthAdmin.deleteUser(id)
      return { data: { user: null }, error: authError() }
    }
  },
  async updateUserById(id: string, input: Omit<UserInput, "password">) {
    const client = await neonPool().connect()
    try {
      await client.query("BEGIN")
      const { rows: [user] } = await client.query<StoredUser>(
        `UPDATE auth.users SET email = $2, name = $3, "emailVerified" = $4, "updatedAt" = now() WHERE id = $1 RETURNING ${fields}`,
        [id, input.email.toLowerCase(), input.user_metadata?.full_name || input.email, Boolean(input.email_confirm)],
      )
      if (!user) throw authError()
      await client.query('DELETE FROM auth.sessions WHERE "userId" = $1', [id])
      await client.query("COMMIT")
      return { data: { user: neonUser(user) }, error: null }
    } catch {
      await client.query("ROLLBACK")
      return { data: { user: null }, error: authError() }
    } finally {
      client.release()
    }
  },
  async deleteUser(id: string) {
    try {
      await neonPool().query("DELETE FROM auth.users WHERE id = $1", [id])
      return { data: {}, error: null }
    } catch (error) {
      return { data: null, error: error instanceof Error && "code" in error && error.code === "23503" ? new Error("foreign key") : authError() }
    }
  },
  async generateLink(input: { email: string }) {
    try {
      const link = await createNeonRecoveryLink(input.email)
      return { data: link ? { properties: { action_link: link } } : null, error: link ? null : authError() }
    } catch {
      return { data: null, error: authError() }
    }
  },
  async inviteUserByEmail(email: string, options?: { data?: { full_name?: string } }) {
    try {
      const existing = await neonPool().query<StoredUser>(`SELECT ${fields} FROM auth.users WHERE email = $1`, [email.toLowerCase()])
      const created = existing.rows[0] ? null : await neonAuthAdmin.createUser({
        email, password: randomBytes(32).toString("base64url"), user_metadata: options?.data,
      })
      const user = existing.rows[0] ? neonUser(existing.rows[0]) : created?.data.user
      if (!user || user.email_confirmed_at) throw authError()
      try {
        await getNeonAuth().api.requestPasswordReset({ body: { email, redirectTo: neonAuthOrigin() + "/reset-password" } })
      } catch (error) {
        if (created?.data.user) await neonAuthAdmin.deleteUser(user.id)
        throw error
      }
      return { data: { user }, error: null }
    } catch {
      return { data: { user: null }, error: authError() }
    }
  },
}
