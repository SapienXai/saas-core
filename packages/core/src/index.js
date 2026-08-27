export const CORE_VERSION = "2.0.0"

export const CORE_CAPABILITIES = Object.freeze([
  "auth", "workspace", "membership", "billing", "domains", "pwa", "platform", "audit", "email", "push",
])

export function defineProductConfig(input) {
  if (!input || typeof input !== "object") throw new TypeError("Product config must be an object.")
  const config = { ...input }
  if (typeof config.name !== "string" || !config.name.trim()) throw new TypeError("Product config requires a name.")
  if (typeof config.slug !== "string" || !/^[a-z][a-z0-9-]+$/.test(config.slug)) throw new TypeError("Product config requires a URL-safe slug.")
  return Object.freeze(config)
}
