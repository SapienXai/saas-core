import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "supabase/migrations/20260823051610_dataengine_outbox_trigger_type.sql",
  "utf8",
)

const canonicalAssertion = `
do $$
declare
  canonical_count integer;
  legacy_count integer;
begin
  select count(*) into canonical_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'email_outbox_runs'
     and column_name = 'trigger_type';
  select count(*) into legacy_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'email_outbox_runs'
     and column_name = 'trigger';
  if canonical_count <> 1 or legacy_count <> 0 then
    raise exception using message = format(
      'outbox migration compatibility assertion failed: trigger_type=%s trigger=%s',
      canonical_count,
      legacy_count
    );
  end if;
end $$;
`

function query(sql) {
  const containers = spawnSync(
    "docker",
    ["ps", "--filter", "name=^/supabase_db_", "--format", "{{.Names}}"],
    { encoding: "utf8" },
  )
  const databaseContainer = containers.stdout.trim().split("\n").find(Boolean)
  if (containers.status !== 0 || !databaseContainer) {
    throw new Error(`Could not find the running Supabase database container: ${containers.stderr || containers.stdout}`)
  }
  return spawnSync(
    "docker",
    ["exec", "-i", databaseContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    {
      encoding: "utf8",
      input: sql,
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    },
  )
}

function expectSuccess(name, sql) {
  const result = query(sql)
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${result.stderr || result.stdout}`)
  }
  console.log(`${name}: pass`)
}

expectSuccess(
  "legacy trigger upgrade",
  `begin;
   alter table public.email_outbox_runs rename column trigger_type to "trigger";
   ${migration}
   ${canonicalAssertion}
   rollback;`,
)

expectSuccess(
  "canonical trigger_type no-op",
  `begin;
   ${migration}
   ${canonicalAssertion}
   rollback;`,
)

expectSuccess(
  "fresh missing-table bootstrap",
  `begin;
   drop table public.email_outbox_runs;
   ${migration}
   ${canonicalAssertion}
   rollback;`,
)

const bothColumns = query(`begin;
  alter table public.email_outbox_runs add column "trigger" text;
  ${migration}
  commit;`)
if (bothColumns.status === 0) {
  throw new Error("both-columns safety check unexpectedly succeeded")
}
expectSuccess("both-columns safety rollback", canonicalAssertion)
console.log("both trigger columns: explicit failure and rollback pass")
