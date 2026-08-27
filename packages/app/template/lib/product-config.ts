export type ProductConfig = {
  name: string
  slug: string
  logoPath: string
  iconPath: string
  themeColor: string
  description: string
  capabilities: Readonly<Record<string, boolean>>
}

/**
 * The only product identity the Core runtime owns. Products can replace this
 * module or provide these values at their app boundary without changing Core
 * authorization, tenancy, or interaction code.
 */
export const PRODUCT_CONFIG: ProductConfig = {
  name: "SaaS Core",
  slug: "saas-core",
  logoPath: "/product-mark.svg",
  iconPath: "/product-mark.svg",
  themeColor: "#7c3aed",
  description: "A production-ready workspace foundation for focused products.",
  capabilities: {
    billing: true,
    domains: true,
    platformControl: true,
    pushNotifications: true,
    pwa: true,
  },
}
