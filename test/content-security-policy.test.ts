import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadProductCspFrameSources, loadProductCspStyleSources, productCspFrameSources } from '../lib/content-security-policy.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
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
