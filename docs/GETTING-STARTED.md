# Getting started

```bash
pnpm install
pnpm check
pnpm lab:dev
```

For a new product, run `npx @sapienx/saas-core init my-product`, inspect the
generated `core.config.ts`, copy `.env.example`, install dependencies and apply
the ordered Supabase migration stream. Product migrations follow the core
timestamp and use `workspace_id` as their tenant key.
