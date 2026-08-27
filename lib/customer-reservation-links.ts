export function buildCustomerReservationManageUrl(publicUrl: string, token: string, language?: string) {
  const url = new URL(publicUrl)
  url.searchParams.set("manageToken", token)
  if (language) url.searchParams.set("lang", language)
  return url.toString()
}
