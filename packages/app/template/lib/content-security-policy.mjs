import { readFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_PRODUCT_SECURITY_CONFIG = path.resolve(process.cwd(), 'src/product/security-config.json')

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {unknown} configuration
 * @returns {string[]}
 */
export function productCspFrameSources(configuration) {
  if (!isRecord(configuration)) {
    throw new TypeError('Product security configuration must be a JSON object.')
  }

  const contentSecurityPolicy = configuration.contentSecurityPolicy
  if (contentSecurityPolicy === undefined) return []
  if (!isRecord(contentSecurityPolicy)) {
    throw new TypeError('contentSecurityPolicy must be a JSON object.')
  }

  const frameSrc = contentSecurityPolicy.frameSrc ?? []
  if (!Array.isArray(frameSrc)) {
    throw new TypeError('contentSecurityPolicy.frameSrc must be an array of HTTPS origins.')
  }

  const sources = new Set()
  for (const source of frameSrc) {
    if (typeof source !== 'string' || source.length === 0 || source.trim() !== source) {
      throw new TypeError('Every contentSecurityPolicy.frameSrc entry must be an exact HTTPS origin.')
    }

    let url
    try {
      url = new URL(source)
    } catch {
      throw new TypeError('Every contentSecurityPolicy.frameSrc entry must be an exact HTTPS origin.')
    }

    if (url.protocol !== 'https:' || url.origin !== source || url.username || url.password || url.hostname.includes('*')) {
      throw new TypeError('Every contentSecurityPolicy.frameSrc entry must be an exact HTTPS origin.')
    }

    sources.add(url.origin)
  }

  return [...sources]
}

/**
 * @param {string} [configPath]
 * @returns {string[]}
 */
export function loadProductCspFrameSources(configPath = DEFAULT_PRODUCT_SECURITY_CONFIG) {
  let contents
  try {
    contents = readFileSync(configPath, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return []
    throw error
  }

  let configuration
  try {
    configuration = JSON.parse(contents)
  } catch {
    throw new TypeError(`Product security configuration at ${configPath} must contain valid JSON.`)
  }

  return productCspFrameSources(configuration)
}
