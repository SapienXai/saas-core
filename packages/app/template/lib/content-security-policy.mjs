import { readFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_PRODUCT_SECURITY_CONFIG = path.resolve(process.cwd(), 'src/product/security-config.json')

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function productCspSources(configuration, directive, allowSubdomainWildcards = false) {
  if (!isRecord(configuration)) {
    throw new TypeError('Product security configuration must be a JSON object.')
  }

  const contentSecurityPolicy = configuration.contentSecurityPolicy
  if (contentSecurityPolicy === undefined) return []
  if (!isRecord(contentSecurityPolicy)) {
    throw new TypeError('contentSecurityPolicy must be a JSON object.')
  }

  const configuredSources = contentSecurityPolicy[directive] ?? []
  if (!Array.isArray(configuredSources)) {
    throw new TypeError(`contentSecurityPolicy.${directive} must be an array of HTTPS origins.`)
  }

  const sources = new Set()
  for (const source of configuredSources) {
    if (typeof source !== 'string' || source.length === 0 || source.trim() !== source) {
      throw new TypeError(`Every contentSecurityPolicy.${directive} entry must be an HTTPS origin.`)
    }

    const wildcardMatch = source.match(/^https:\/\/\*\.([a-z0-9.-]+)$/i)
    if (wildcardMatch) {
      const hostname = wildcardMatch[1]
      if (
        !allowSubdomainWildcards
        || !hostname.includes('.')
        || hostname.includes('..')
        || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))+$/i.test(hostname)
      ) {
        throw new TypeError(`Every contentSecurityPolicy.${directive} wildcard entry must be a valid HTTPS subdomain source.`)
      }

      const url = new URL(`https://${hostname}`)
      if (url.origin !== `https://${hostname.toLowerCase()}` || url.username || url.password) {
        throw new TypeError(`Every contentSecurityPolicy.${directive} wildcard entry must be a valid HTTPS subdomain source.`)
      }

      sources.add(`https://*.${url.hostname}`)
      continue
    }

    let url
    try {
      url = new URL(source)
    } catch {
      throw new TypeError(`Every contentSecurityPolicy.${directive} entry must be an exact HTTPS origin.`)
    }

    if (url.protocol !== 'https:' || url.origin !== source || url.username || url.password || url.hostname.includes('*')) {
      throw new TypeError(`Every contentSecurityPolicy.${directive} entry must be an exact HTTPS origin.`)
    }

    sources.add(url.origin)
  }

  return [...sources]
}

/** @param {unknown} configuration @returns {string[]} */
export function productCspFrameSources(configuration) {
  return productCspSources(configuration, 'frameSrc')
}

/** @param {unknown} configuration @returns {string[]} */
export function productCspScriptSources(configuration) {
  return productCspSources(configuration, 'scriptSrc')
}

/** @param {unknown} configuration @returns {string[]} */
export function productCspConnectSources(configuration) {
  return productCspSources(configuration, 'connectSrc', true)
}

/**
 * @param {string} [configPath]
 * @returns {unknown}
 */
function loadProductSecurityConfiguration(configPath) {
  let contents
  try {
    contents = readFileSync(configPath, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return { contentSecurityPolicy: {} }
    throw error
  }

  let configuration
  try {
    configuration = JSON.parse(contents)
  } catch {
    throw new TypeError(`Product security configuration at ${configPath} must contain valid JSON.`)
  }

  return configuration
}

/** @param {string} [configPath] @returns {string[]} */
export function loadProductCspFrameSources(configPath = DEFAULT_PRODUCT_SECURITY_CONFIG) {
  return productCspFrameSources(loadProductSecurityConfiguration(configPath))
}

/** @param {string} [configPath] @returns {string[]} */
export function loadProductCspScriptSources(configPath = DEFAULT_PRODUCT_SECURITY_CONFIG) {
  return productCspScriptSources(loadProductSecurityConfiguration(configPath))
}

/** @param {string} [configPath] @returns {string[]} */
export function loadProductCspConnectSources(configPath = DEFAULT_PRODUCT_SECURITY_CONFIG) {
  return productCspConnectSources(loadProductSecurityConfiguration(configPath))
}

/** @param {string} [configPath] @returns {string[]} */
export function loadProductCspStyleSources(configPath = DEFAULT_PRODUCT_SECURITY_CONFIG) {
  return productCspSources(loadProductSecurityConfiguration(configPath), 'styleSrc')
}
