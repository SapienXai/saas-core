import { redirect } from "next/navigation"

export default function LegacyUpdatePasswordPage() {
  redirect("/reset-password")
}
