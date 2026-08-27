/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.SAAS_CORE_E2E === '1' ? '.next-e2e' : '.next',
  // Keep LAN testing interactive as well as loopback testing. Next's dev
  // asset guard otherwise serves the HTML but blocks the client chunks, which
  // leaves server-rendered buttons without their React event handlers.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.1.117'],
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

    if (process.env.NODE_ENV === 'production') {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' })
      headers.push({
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'self'",
          "object-src 'none'",
          "script-src 'self' 'unsafe-inline' https://cdn.paddle.com https://*.paddle.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "media-src 'self' blob: https:",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.paddle.com https://tiles.openfreemap.org",
          "frame-src 'self' https://*.paddle.com",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
        ].join('; '),
      })
    }

    return [{ source: '/(.*)', headers }]
  },
}

export default nextConfig
