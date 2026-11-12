import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { Pool } from "@sapienx/saas-core/postgres"

const connectionString = process.env.DATABASE_URL_UNPOOLED
if (!connectionString) throw new Error("Set DATABASE_URL_UNPOOLED to the direct connection for the intended Core database.")
if (process.env.NEXT_PUBLIC_SAAS_CORE_BACKEND !== "neon") throw new Error("Select Neon mode before running the database setup.")
const grantDataRole = process.argv.includes("--grant-data-role")
const dataLogin = grantDataRole ? new URL(process.env.SAAS_CORE_DATA_DATABASE_URL || "") : null
if (dataLogin) {
  const owner = new URL(connectionString)
  const baseHost = (url) => url.hostname.replace(/-pooler(?=\.)/, "")
  const name = decodeURIComponent(dataLogin.username)
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name) || ["anon", "authenticated", "service_role"].includes(name)
      || name === decodeURIComponent(owner.username) || dataLogin.pathname !== owner.pathname
      || baseHost(dataLogin) !== baseHost(owner) || dataLogin.port !== owner.port) {
    throw new Error("The data login must be dedicated to the same database and branch.")
  }
}
const root = new URL("../", import.meta.url)
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 })
const client = await pool.connect()

async function apply(name, sql) {
  const hash = createHash("sha256").update(sql).digest("hex")
  await client.query("BEGIN")
  try {
    const { rows: [previous] } = await client.query("SELECT sha256 FROM core_neon.migrations WHERE name = $1", [name])
    if (previous && previous.sha256 !== hash) throw new Error(`Applied migration changed: ${name}`)
    if (!previous) {
      // Some immutable Core migrations include a surrounding transaction.
      const body = sql.replace(/^\s*begin;\s*/i, "").replace(/\s*commit;\s*$/i, "")
      await client.query(body)
      await client.query("INSERT INTO core_neon.migrations (name, sha256) VALUES ($1, $2)", [name, hash])
      console.log("Applied " + name)
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

try {
  await client.query("SELECT pg_advisory_lock(463109825173)")
  await client.query(`
    DO $$
    BEGIN
      IF to_regclass('core_neon.migrations') IS NULL AND (
        to_regnamespace('auth') IS NOT NULL OR to_regnamespace('storage') IS NOT NULL OR
        to_regclass('public.workspaces') IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'An existing backend is present; initialize a clean database or plan a data migration first.';
      END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS core_neon;
    REVOKE ALL ON SCHEMA core_neon FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS core_neon.migrations (name text PRIMARY KEY, sha256 text NOT NULL);
  `)
  await apply("bootstrap.sql", await readFile(new URL("lib/neon/bootstrap.sql", root), "utf8"))
  const directory = new URL("supabase/migrations/", root)
  for (const filename of (await readdir(directory)).filter(name => /^\d{14}_.+\.sql$/.test(name)).sort()) {
    await apply(filename, await readFile(new URL(filename, directory), "utf8"))
  }
  // Neon roles created through SQL do not need BYPASSRLS. These policies only
  // apply to the server role, and existing table-level grants still apply.
  await client.query(`
    DO $$
    DECLARE target record;
    BEGIN
      FOR target IN
        SELECT n.nspname, c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relrowsecurity AND n.nspname = 'public'
          AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'core_neon_service_role')
      LOOP
        EXECUTE format('CREATE POLICY core_neon_service_role ON %I.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          target.nspname, target.relname);
      END LOOP;
    END $$;
    NOTIFY pgrst, 'reload schema';
  `)
  if (dataLogin) {
    const name = decodeURIComponent(dataLogin.username)
    const { rows: [login] } = await client.query(`
      SELECT rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication)
        AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles t ON t.oid = m.roleid
          WHERE m.member = r.oid AND t.rolname NOT IN ('anon','authenticated','service_role')) AS allowed
      FROM pg_catalog.pg_roles r WHERE rolname = $1
    `, [name])
    if (!login?.allowed) throw new Error("Create a dedicated LOGIN NOINHERIT NOBYPASSRLS role before granting data access.")
    await client.query(`GRANT anon, authenticated, service_role TO "${name}" WITH INHERIT FALSE, SET TRUE, ADMIN FALSE`)
    console.log("Granted transaction-only access to the dedicated data login.")
  }
  console.log("Neon schema is ready.")
} finally {
  client.release(true)
  await pool.end()
}
