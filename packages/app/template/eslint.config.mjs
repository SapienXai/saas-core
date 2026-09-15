import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      // These interaction refs intentionally drive pointer/copy event behavior.
      "react-hooks/refs": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "node_modules/**",
    "scripts/dev-only/**",
    "out/**",
    "build/**",
    "dist/**",
    "**/dist/**",
    "supabase/.branches/**",
    "supabase/.temp/**",
    "public/vendor/**",
    "next-env.d.ts",
  ]),
])
