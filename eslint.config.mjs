import eslint from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["**/dist/**", "node_modules/**", "artifacts/**", ".reference/**", "apps/core-lab/public/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", process: "readonly", console: "readonly" } },
  },
)
