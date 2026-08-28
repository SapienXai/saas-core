import { OrbLoader } from "./orb-loader"

export function PageLoading({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <main className={`flex min-h-[min(70vh,620px)] items-center justify-center px-6 py-16 ${className}`}>
      <OrbLoader label={label} state="working" />
    </main>
  )
}

export function ManagementPageLoading({ label }: { label?: string }) {
  return (
    <div className="management-page-loading flex min-h-[100dvh] items-center justify-center px-6 py-16">
      <OrbLoader label={label} state="working" />
    </div>
  )
}
