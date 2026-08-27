# Reservevia fresh-cloud bootstrap

The normal local development lifecycle intentionally remains the historical
Felix-compatible migration chain plus `supabase/seed.sql`:

```text
npm run db:reset
```

That path is deterministic and is used by local integration tests. Its first
migration and local seed contain synthetic Felix-compatible fixtures for
regression coverage. They are never a production data source.

## Create an empty Reservevia cloud database

1. Create or select a dedicated Reservevia Supabase project, never FelixRez.
2. Reset the local database and regenerate the schema artifact:

   ```text
   npm run db:reset
   npm run db:bootstrap:generate
   ```

   The generated `reservevia-schema.sql` contains current `public` and
   `private` definitions only. It contains no table rows and generation fails
   if known local fixture markers appear.
3. Apply these files to the empty cloud database in order using the project’s
   database connection or SQL editor:

   ```text
   supabase/bootstrap/reservevia-schema.sql
   supabase/bootstrap/storage-policies.sql
   supabase/bootstrap/production-seed.sql
   ```

4. Register the existing migration versions as already applied. Use the
   explicit project link and the exact migration version numbers from
   `supabase/migrations/`, for example:

   ```text
   pnpm exec supabase link --project-ref <RESERVEVIA_STAGING_PROJECT_REF>
   pnpm exec supabase migration repair --linked --status applied \
     202608090000 202608090001 202608090002 202608090003 \
     20260809151152 20260809155804 20260809155856 20260809165536 \
     20260809180000 20260809190337 20260809202646 20260809214318 \
     20260810120000 20260810203406 20260810210342 20260810214013 \
     20260811220156 20260812082832 20260812083206 20260812102514 \
     20260812112914 20260812120000 20260812150000 20260812160000 \
     20260812170000 20260812190000 20260812220000 20260812235000 \
     20260813120000 20260813130000 20260822101703 20260822114730 20260822130000
   ```

   Confirm the result with `pnpm exec supabase migration list --linked`. This list must include every versioned file in `supabase/migrations/` whenever a new migration is added.

After this one-time bootstrap, future migrations use the normal repository
chain and `pnpm exec supabase db push --linked`. Local development continues to use
`npm run db:reset`; new cloud projects use the schema artifact, storage
bootstrap, catalog seed, and migration-history registration. The artifact must
be regenerated and reviewed whenever a new fresh-cloud environment is created
after schema changes.

This workflow deliberately does not run the Felix-compatible baseline or
`supabase/seed.sql` against a new cloud database.
