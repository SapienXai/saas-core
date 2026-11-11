import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import nextConfig from '../next.config.mjs'
import { loadProductCspFrameSources, loadProductCspStyleSources, productCspFrameSources } from '../lib/content-security-policy.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('Paddle checkout CSP', () => {
  it('allows Sandbox origins on the checkout route when the provider defaults to Paddle', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SAAS_CORE_BILLING_PROVIDER', undefined)
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox')

    const headers = await nextConfig.headers!()
    const checkoutPolicy = headers.find(rule => rule.source === '/billing/paddle/checkout')?.headers[0]?.value
    expect(checkoutPolicy).toContain('https://sandbox-buy.paddle.com')
    expect(checkoutPolicy).toContain('https://sandbox-api.paddle.com')
    expect(checkoutPolicy).not.toContain('https://buy.paddle.com')
    expect(headers.find(rule => rule.source === '/(.*)')?.headers.at(-1)?.value).not.toContain('paddle.com')

    vi.stubEnv('SAAS_CORE_BILLING_PROVIDER', 'stripe')
    expect(await nextConfig.headers!()).toHaveLength(1)
  })
})

describe('product CSP frame sources', () => {
  it('adds unique exact HTTPS origins from product configuration', () => {
    expect(productCspFrameSources({
      contentSecurityPolicy: {
        frameSrc: ['https://midjourney.tv', 'https://www.midjourney.tv', 'https://midjourney.tv'],
      },
    })).toEqual(['https://midjourney.tv', 'https://www.midjourney.tv'])
  })

  it('rejects sources that are not exact HTTPS origins', () => {
    expect(() => productCspFrameSources({ contentSecurityPolicy: { frameSrc: ['http://video.example'] } })).toThrow()
    expect(() => productCspFrameSources({ contentSecurityPolicy: { frameSrc: ['https://video.example/path'] } })).toThrow()
    expect(() => productCspFrameSources({ contentSecurityPolicy: { frameSrc: ['https://*.example'] } })).toThrow()
  })

  it('keeps the product-owned Next config style source export compatible', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'saas-core-csp-'))
    temporaryDirectories.push(directory)
    const configPath = path.join(directory, 'security-config.json')
    expect(loadProductCspStyleSources(configPath)).toEqual([])
    writeFileSync(configPath, JSON.stringify({ contentSecurityPolicy: { styleSrc: ['https://styles.example', 'https://styles.example'] } }))
    expect(loadProductCspStyleSources(configPath)).toEqual(['https://styles.example'])
    writeFileSync(configPath, JSON.stringify({ contentSecurityPolicy: { styleSrc: ['https://*.styles.example'] } }))
    expect(() => loadProductCspStyleSources(configPath)).toThrow(/styleSrc wildcard/)
  })

  it('loads an optional product security config and fails clearly on invalid JSON', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'saas-core-csp-'))
    temporaryDirectories.push(directory)
    const configPath = path.join(directory, 'security-config.json')
    writeFileSync(configPath, JSON.stringify({ contentSecurityPolicy: { frameSrc: ['https://video.example'] } }))
    expect(loadProductCspFrameSources(configPath)).toEqual(['https://video.example'])

    writeFileSync(configPath, '{')
    expect(() => loadProductCspFrameSources(configPath)).toThrow(/must contain valid JSON/)
  })
})
