import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const outputPath = "supabase/bootstrap/reservevia-schema.sql"
const dataEngineMigrationPath = "supabase/migrations/20260822101703_dataengine_reservevia_import.sql"
const dataEngineHardeningMigrationPath = "supabase/migrations/20260822114730_dataengine_reservevia_hardening.sql"
const dataEngineOutboxMigrationPath = "supabase/migrations/20260822130000_dataengine_outbox_observability.sql"
mkdirSync("supabase/bootstrap", { recursive: true })

execFileSync(
  "supabase",
  ["db", "dump", "--local", "--schema", "public,private", "--file", outputPath],
  { stdio: "inherit" },
)

const schema = `${readFileSync(outputPath, "utf8").trimEnd()}\n\n-- Additive DataEngine import boundary.\n${readFileSync(dataEngineMigrationPath, "utf8").trim()}\n\n-- Production hardening for the DataEngine import saga.\n${readFileSync(dataEngineHardeningMigrationPath, "utf8").trim()}\n`
const schemaWithOutbox = `${schema.trimEnd()}\n\n-- Private email outbox invocation observability.\n${readFileSync(dataEngineOutboxMigrationPath, "utf8").trim()}\n`
writeFileSync(outputPath, schemaWithOutbox)
const forbiddenFixtureMarkers = [
  "Felix Beach",
  "Test Restaurant Group",
  "Felix Test Guest",
  "admin@felixrestaurants.com",
]

for (const marker of forbiddenFixtureMarkers) {
  if (schemaWithOutbox.includes(marker)) {
    throw new Error(`Production bootstrap contains a development fixture marker: ${marker}`)
  }
}

console.log(`Generated ${outputPath} from the local schema only. No table rows are included.`)
