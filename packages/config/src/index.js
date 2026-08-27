export const PRODUCT_CONFIG_VERSION = "2.0.0"

export function createProductConfig(input) {
  if (!input || typeof input !== "object") throw new TypeError("Product configuration must be an object.")
  const config = { ...input }
  if (typeof config.name !== "string" || !config.name.trim()) throw new TypeError("Product configuration requires name.")
  if (typeof config.slug !== "string" || !/^[a-z][a-z0-9-]+$/.test(config.slug)) throw new TypeError("Product configuration requires slug.")
  return Object.freeze(config)
}
