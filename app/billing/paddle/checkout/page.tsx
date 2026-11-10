import { notFound, redirect } from "next/navigation"
import { getCurrentWorkspace } from "@/lib/authorization"
import { isBillingProviderConfigured } from "@/lib/billing/providers"
import { getPaddleReturnPath, getPaddleSandboxConfig } from "@/lib/billing/providers/paddle"
import { getVerifiedPaddleCheckout } from "@/lib/billing/paddle-webhook"
import PaddleCheckout from "./paddle-checkout"

export default async function PaddleCheckoutPage({ searchParams }: { searchParams: Promise<{ transaction?: string }> }) {
  if (process.env.SAAS_CORE_BILLING_PROVIDER !== "paddle" || !isBillingProviderConfigured()) notFound()
  const { transaction } = await searchParams
  if (typeof transaction !== "string") notFound()
  const membership = await getCurrentWorkspace().catch(() => null)
  if (!membership || membership.role !== "owner") notFound()
  const verified = await getVerifiedPaddleCheckout(transaction, membership.workspace_id)
  if (!verified) notFound()
  const { session } = verified
  const { clientToken, siteOrigin } = getPaddleSandboxConfig()
  const successPath = getPaddleReturnPath(session.metadata.success_url, siteOrigin, transaction, true)
  const cancelPath = getPaddleReturnPath(session.metadata.cancel_url, siteOrigin, transaction, false)
  if (session.status === "complete" || session.paymentStatus === "paid") redirect(successPath)
  if (session.status !== "open") redirect(cancelPath)
  return <PaddleCheckout transactionId={transaction} clientToken={clientToken} successPath={successPath} cancelPath={cancelPath} />
}
