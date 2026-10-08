const RUNTIME_ENVIRONMENT_KEYS = [
  "NODE_ENV",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SAAS_CORE_ROOT_DOMAIN",
  "SAAS_CORE_APP_DOMAIN",
  "SAAS_CORE_APP_URL",
  "NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "SAAS_CORE_MAIL_URL",
  "NEXT_PUBLIC_DEV_MAILPIT_URL",
  "SAAS_CORE_E2E",
  "SAAS_CORE_FULL_E2E",
  "SAAS_CORE_RATE_LIMIT_SECRET",
  "SAAS_CORE_API_CREDENTIAL_PEPPER",
  "CRON_SECRET",
  "STRIPE_ENVIRONMENT",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_ACCOUNT_ID",
  "STRIPE_BILLING_PORTAL_CONFIGURATION_ID",
]

const LOCAL_ROOT_DOMAIN = "saas.example.com"
const LOCAL_APP_DOMAIN = "app.saas.example.com"
const LOCAL_APP_URL = "http://127.0.0.1:3100"
const LOCAL_MAIL_URL = "http://127.0.0.1:55624"

export function createReleaseToolingEnvironment(source = process.env) {
  const environment = { ...source }
  for (const key of RUNTIME_ENVIRONMENT_KEYS) delete environment[key]
  return environment
}

export function createReleaseUnitEnvironment(source = process.env) {
  return { ...createReleaseToolingEnvironment(source), NODE_ENV: "test" }
}

export function createBuildEnvironment(source = process.env) {
  return {
    ...createReleaseToolingEnvironment(source),
    NODE_ENV: "production",
    NEXT_PUBLIC_SITE_URL: LOCAL_APP_URL,
    NEXT_PUBLIC_APP_URL: LOCAL_APP_URL,
    SAAS_CORE_APP_URL: LOCAL_APP_URL,
    SAAS_CORE_ROOT_DOMAIN: LOCAL_ROOT_DOMAIN,
    SAAS_CORE_APP_DOMAIN: LOCAL_APP_DOMAIN,
    NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN: LOCAL_APP_DOMAIN,
    STRIPE_ENVIRONMENT: "sandbox",
  }
}

export function createLocalSupabaseEnvironment(source, status) {
  return {
    ...createReleaseToolingEnvironment(source),
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: status.JWT_SECRET,
  }
}

export function createLocalE2EEnvironment(source, status) {
  const environment = createLocalSupabaseEnvironment(source, status)
  const requestedAppUrl = source.SAAS_CORE_E2E_APP_URL?.trim()
  const appUrl = /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(requestedAppUrl || "") ? requestedAppUrl : LOCAL_APP_URL
  const mailUrl = status.INBUCKET_URL || LOCAL_MAIL_URL

  return {
    ...environment,
    NEXT_PUBLIC_SITE_URL: appUrl,
    NEXT_PUBLIC_APP_URL: appUrl,
    SAAS_CORE_APP_URL: appUrl,
    SAAS_CORE_ROOT_DOMAIN: LOCAL_ROOT_DOMAIN,
    SAAS_CORE_APP_DOMAIN: LOCAL_APP_DOMAIN,
    NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN: LOCAL_APP_DOMAIN,
    SAAS_CORE_MAIL_URL: mailUrl,
    NEXT_PUBLIC_DEV_MAILPIT_URL: mailUrl,
    SAAS_CORE_E2E: "1",
    ...(source.SAAS_CORE_FULL_E2E === "1" ? { SAAS_CORE_FULL_E2E: "1" } : {}),
  }
}

export { LOCAL_APP_DOMAIN, LOCAL_APP_URL, LOCAL_MAIL_URL, LOCAL_ROOT_DOMAIN, RUNTIME_ENVIRONMENT_KEYS }
