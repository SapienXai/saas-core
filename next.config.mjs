import { loadProductCspConnectSources, loadProductCspFrameSources, loadProductCspScriptSources } from './lib/content-security-policy.mjs'

const productCspFrameSources = loadProductCspFrameSources()
const productCspScriptSources = loadProductCspScriptSources()
const productCspConnectSources = loadProductCspConnectSources()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.SAAS_CORE_E2E === '1' ? '.next-e2e' : '.next',
  // Keep LAN testing interactive as well as loopback testing. Next's dev
  // asset guard otherwise serves the HTML but blocks the client chunks, which
  // leaves server-rendered buttons without their React event handlers.
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '10.*.*.*',
    '172.*.*.*',
    '192.168.*.*',
    '**.nip.io',
    '*.trycloudflare.com',
    '*.ngrok-free.app',
    '*.ngrok-free.dev',
    '*.ngrok.app',
    '*.ngrok.io',
  ],
  // Development-only pages and route handlers use a compound extension. They
  // are intentionally invisible to production route discovery and bundling.
  pageExtensions:
    process.env.NODE_ENV === 'production'
      ? ['js', 'jsx', 'ts', 'tsx']
      : ['js', 'jsx', 'ts', 'tsx', 'dev.js', 'dev.jsx', 'dev.ts', 'dev.tsx'],
  async headers() {
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    ]

    let paddleHeaders = null
    if (process.env.NODE_ENV === 'production') {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' })
      const contentSecurityPolicy = (paddleOrigins = []) => ({
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'self'",
          "object-src 'none'",
          `script-src 'self' 'unsafe-inline' ${[...productCspScriptSources, ...(paddleOrigins.length ? ['https://cdn.paddle.com'] : [])].join(' ')}`.trim(),
          `style-src 'self' 'unsafe-inline'${paddleOrigins.length ? ' https://cdn.paddle.com' : ''}`,
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "media-src 'self' blob: https:",
          `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://tiles.openfreemap.org ${[...productCspConnectSources, ...paddleOrigins].join(' ')}`.trim(),
          `frame-src 'self' ${[...productCspFrameSources, ...paddleOrigins.slice(0, 1)].join(' ')}`.trim(),
          "worker-src 'self' blob:",
          "manifest-src 'self'",
        ].join('; '),
      })
      if (process.env.SAAS_CORE_BILLING_PROVIDER?.trim() === 'paddle') {
        const prefix = process.env.PADDLE_ENVIRONMENT === 'sandbox' ? 'sandbox-' : ''
        paddleHeaders = [contentSecurityPolicy([
          `https://${prefix}buy.paddle.com`,
          `https://${prefix}api.paddle.com`,
          'https://cdn.paddle.com',
        ])]
      }
      headers.push(contentSecurityPolicy())
    }

    // Next uses the last matching value for the same header name.
    return [{ source: '/(.*)', headers }, ...(paddleHeaders ? [{
      source: '/billing/paddle/checkout',
      headers: paddleHeaders,
    }] : [])]
  },
}

export default nextConfig
