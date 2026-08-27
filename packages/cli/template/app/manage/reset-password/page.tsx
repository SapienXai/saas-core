import { redirect } from "next/navigation"

export default function LegacyResetPasswordPage() {
  redirect("/forgot-password")
}
