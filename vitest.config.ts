import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  resolve: {
    alias: {
      "@sapienx/saas-core": resolve("packages/core/src/index.ts"),
      "@sapienx/saas-core-config": resolve("packages/config/src/index.ts"),
      "@sapienx/saas-core-runtime": resolve("packages/runtime/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
})
