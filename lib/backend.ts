// Build and runtime use the same value so browser and server select the same provider.
export function usesNeonBackend() {
  return process.env.NEXT_PUBLIC_SAAS_CORE_BACKEND === "neon"
}
