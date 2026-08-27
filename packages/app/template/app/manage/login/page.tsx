import { redirect } from "next/navigation"

export default async function LegacyManageLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const redirectPath = typeof params.redirect === "string" ? params.redirect : "/manage"
  redirect(`/login?redirect=${encodeURIComponent(redirectPath)}`)
}
