import { getPlatformOverview } from "@/lib/platform-admin"
import { PlatformOverview } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default async function PlatformPage() { const result = await getPlatformOverview(); return <PlatformOverview counts={result.counts} role={result.role} /> }
