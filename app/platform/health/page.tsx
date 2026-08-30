import { getPlatformOverview } from "@/lib/platform-admin"
import { PlatformHealth } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default async function PlatformHealthPage() { const result = await getPlatformOverview(); return <PlatformHealth counts={result.counts} role={result.role} /> }
