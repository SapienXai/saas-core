export type PendingCheckoutResumeCandidate = {
  workspace_id: string
  provider: string
  environment: string
  target_plan_key: string
  provider_price_id: string
  provider_transaction_id: string | null
  idempotency_key: string
  status: string
}

export type PendingCheckoutMutationCandidate = {
  id: string
  operation: string
  status: string
}

export function canResumePendingCheckout(input: {
  checkout: PendingCheckoutResumeCandidate
  mutation: PendingCheckoutMutationCandidate
  workspaceId: string
  provider: string
  environment: string
  planKey: string
  priceId: string
}) {
  const { checkout, mutation } = input
  return checkout.workspace_id === input.workspaceId &&
    checkout.provider === input.provider &&
    checkout.environment === input.environment &&
    checkout.target_plan_key === input.planKey &&
    checkout.provider_price_id === input.priceId &&
    checkout.status === "created" &&
    Boolean(checkout.provider_transaction_id) &&
    checkout.idempotency_key === mutation.id &&
    mutation.operation === "checkout" &&
    (mutation.status === "pending" || mutation.status === "unknown")
}
