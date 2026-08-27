export const PUBLIC_CRAWL_PATHS = ["/", "/restaurants", "/r/", "/docs", "/privacy", "/terms", "/pricing"]
export const PRIVATE_CRAWL_PATHS = ["/manage", "/platform", "/login", "/signup", "/onboarding", "/reset-password", "/auth/", "/debug", "/api/", "/reservation/manage/"]

export function trainingCrawlerPolicy() {
  return process.env.RESERVEVIA_TRAINING_CRAWLERS === "allow" ? "allow" : "disallow"
}
