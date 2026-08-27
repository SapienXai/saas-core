import type { ReactNode } from "react"
import { MarketingFooter } from "@/components/marketing/marketing-footer"
import { MarketingHeader } from "@/components/marketing/marketing-header"

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-site">
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  )
}
