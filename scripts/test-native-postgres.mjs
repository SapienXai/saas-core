import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { createNativeDataClient, Pool, postgresPool } from "@sapienx/saas-core/postgres"

const urls = [process.env.DATABASE_URL_UNPOOLED, process.env.SAAS_CORE_DATA_DATABASE_URL].map((value) => new URL(value))
assert.ok(urls.every((url) => url.hostname === "127.0.0.1" && url.pathname === "/core_native29"), "This fixture requires the isolated local Core database.")
assert.equal(process.env.SAAS_CORE_DATA_POOL_MAX, "1")
const admin = new Pool({ connectionString: urls[0].href, max: 1 })
const userA = randomUUID()
const userB = randomUUID()
const a = createNativeDataClient({ role: "authenticated", id: userA })
const b = createNativeDataClient({ role: "authenticated", id: userB })
const anon = createNativeDataClient({ role: "anon" })
const service = createNativeDataClient({ role: "service_role" })
const ids = [randomUUID(), randomUUID()]
const probe = "core_native29_probe"
const inspect = "core_native29_context"

await admin.query(`
  CREATE TABLE IF NOT EXISTS public.core_native29_probe (
    id uuid PRIMARY KEY, actor_id uuid NOT NULL, label text NOT NULL, payload jsonb
  );
  ALTER TABLE public.core_native29_probe ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS user_read ON public.core_native29_probe;
  DROP POLICY IF EXISTS service_access ON public.core_native29_probe;
  CREATE POLICY user_read ON public.core_native29_probe FOR SELECT TO authenticated USING (actor_id = auth.uid());
  CREATE POLICY service_access ON public.core_native29_probe FOR ALL TO service_role USING (true) WITH CHECK (true);
  GRANT SELECT ON public.core_native29_probe TO authenticated, anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.core_native29_probe TO service_role;
  CREATE OR REPLACE FUNCTION public.core_native29_context()
    RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog
    AS $$ SELECT jsonb_build_object('role', current_user, 'actor', auth.uid(), 'pid', pg_backend_pid()) $$;
  REVOKE ALL ON FUNCTION public.core_native29_context() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.core_native29_context() TO anon, authenticated, service_role;
  CREATE OR REPLACE FUNCTION public.core_native29_timeout()
    RETURNS void LANGUAGE sql SET search_path = pg_catalog AS $$ SELECT pg_sleep(10) $$;
  REVOKE ALL ON FUNCTION public.core_native29_timeout() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.core_native29_timeout() TO authenticated;
`)
await admin.query("INSERT INTO public.core_native29_probe(id, actor_id, label) VALUES ($1, $2, 'a'), ($3, $4, 'b')", [ids[0], userA, ids[1], userB])

async function baseline() {
  const result = await postgresPool().query("SELECT current_user AS role, pg_backend_pid() AS pid, NULLIF(current_setting('request.jwt.claims', true), '') AS claims")
  assert.equal(result.rows[0].role, decodeURIComponent(urls[1].username))
  assert.equal(result.rows[0].claims, null)
  return result.rows[0].pid
}

try {
  await test("one connection isolates authenticated, anonymous and service transactions", async () => {
    const pid = await baseline()
    const cases = [[a, "authenticated", userA, [ids[0]]], [b, "authenticated", userB, [ids[1]]],
      [anon, "anon", null, []], [service, "service_role", null, ids], [a, "authenticated", userA, [ids[0]]]]
    for (const [client, role, actor, visible] of cases) {
      const context = await client.rpc(inspect)
      assert.deepEqual(context.data, { role, actor, pid })
      const read = await client.from(probe).select("id").in("id", ids)
      assert.equal(read.error, null)
      assert.deepEqual(read.data.map((row) => row.id).sort(), visible.slice().sort())
      assert.equal(await baseline(), pid)
    }
    assert.equal((await anon.from("billing_mutations").select("id")).error.code, "42501")
    assert.equal((await a.rpc("get_core_schema_metadata")).error.code, "42883")
    assert.equal((await createNativeDataClient({ role: "postgres" }).rpc(inspect)).error.code, "42501")
    assert.equal((await createNativeDataClient({ role: "authenticated", id: "bad" }).rpc(inspect)).error.code, "42501")
  })

  await test("parameterized values, shape, counts, conflict keys and rollback", async () => {
    const pid = await baseline()
    const label = "guest \"' Ω; select pg_sleep(10)"
    const payload = { names: ["quoted", "Ω"], nested: { value: null } }
    const upsert = await service.from(probe).upsert({ id: ids[0], actor_id: userA, label, payload }, { onConflict: "id" }).select("label,payload").single()
    assert.deepEqual(upsert.data, { label, payload })
    assert.equal((await a.from(probe).select("id", { count: "exact", head: true }).eq("label", label)).count, 1)
    assert.deepEqual((await a.from(probe).select("id").eq("id", ids[1]).maybeSingle()).data, null)
    assert.equal((await a.from(probe).select("id").eq("id", ids[1]).single()).error.code, "PGRST116")
    assert.ok((await a.from(probe).select("id").order("id;select 1")).error)
    assert.ok((await a.from(probe).select("id").eq("id) OR TRUE--", ids[1])).error)
    assert.ok((await service.from(probe).upsert({ id: ids[0], actor_id: userA, label }, { onConflict: "id) DO NOTHING;--" })).error)
    assert.ok((await service.rpc("pg_read_file", { filename: "/etc/passwd" })).error)
    assert.ok((await service.from(probe).delete().where({ all: [] })).error)
    const duplicate = await service.from(probe).insert({ id: ids[0], actor_id: userA, label })
    assert.equal(duplicate.error.code, "23505")
    assert.equal(await baseline(), pid)
    assert.equal((await a.rpc("core_native29_timeout")).error.code, "57014")
    assert.equal(await baseline(), pid)
    assert.equal((await a.from(probe).select("label").eq("id", ids[0]).single()).data.label, label)
  })
} finally {
  await admin.query("DELETE FROM public.core_native29_probe WHERE id = ANY($1::uuid[])", [ids])
  await admin.end()
  await postgresPool().end()
}
