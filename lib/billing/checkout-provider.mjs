/** Resolve the new checkout provider for both Next configuration and the runtime. */
export function getSelectedCheckoutProvider() {
  const provider = process.env.SAAS_CORE_BILLING_PROVIDER?.trim() || "paddle"
  return provider === "paddle" || provider === "stripe" ? provider : null
}
