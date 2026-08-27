import { PlatformAttention } from "@/components/platform/platform-generic"
export const dynamic = "force-dynamic"
export default function PlatformHealthPage() { return <PlatformAttention title="System health" description="Core health checks are available at /api/health. Add provider-specific checks as the product integration grows." /> }
