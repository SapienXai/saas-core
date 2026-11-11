import { notFound, redirect } from "next/navigation"
import { AuthorizationError, getCurrentWorkspace } from "@/lib/authorization"
import { isBillingProviderConfigured } from "@/lib/billing/providers"
import { getPaddleReturnPath, getPaddleConfig, isPaddleTransactionId } from "@/lib/billing/providers/paddle"
import { getVerifiedPaddleCheckout, getVerifiedPaddlePaymentUpdate } from "@/lib/billing/paddle-webhook"
import PaddleCheckout from "./paddle-checkout"

export default async function PaddleCheckoutPage({ searchParams }: { searchParams: Promise<{ transaction?: string; _ptxn?: string }> }) {
  if (process.env.SAAS_CORE_BILLING_PROVIDER !== "paddle" || !isBillingProviderConfigured()) notFound()
  const params = await searchParams
  const transaction = params.transaction ?? params._ptxn
  if (typeof transaction !== "string" || !isPaddleTransactionId(transaction)) notFound()
  if (!params.transaction) redirect("/billing/paddle/checkout?transaction=" + transaction)

  const membership = await getCurrentWorkspace().catch(error => {
    if (error instanceof AuthorizationError && error.code === "UNAUTHENTICATED") {
      redirect("/login?redirect=" + encodeURIComponent("/billing/paddle/checkout?transaction=" + transaction))
    }
    throw error
  })
  if (!membership || membership.role !== "owner") notFound()

  const { clientToken, siteOrigin, environment } = getPaddleConfig()
  const verified = await getVerifiedPaddleCheckout(transaction, membership.workspace_id)
  if (!verified) {
    if (!await getVerifiedPaddlePaymentUpdate(transaction, membership.workspace_id)) notFound()
    return <PaddleCheckout transactionId={transaction} clientToken={clientToken} environment={environment} successPath="/manage/plan" cancelPath="/manage/plan" />
  }
  const { session } = verified
  const successPath = getPaddleReturnPath(session.metadata.success_url, siteOrigin, transaction, true)
  const cancelPath = getPaddleReturnPath(session.metadata.cancel_url, siteOrigin, transaction, false)
  if (session.status === "complete" || session.paymentStatus === "paid") redirect(successPath)
  if (session.status !== "open") redirect(cancelPath)
  return <PaddleCheckout transactionId={transaction} clientToken={clientToken} environment={environment} successPath={successPath} cancelPath={cancelPath} />
}
