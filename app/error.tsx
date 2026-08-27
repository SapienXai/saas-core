"use client"

import { useEffect } from "react"
import { ConsumerStatePage } from "@/components/consumer-state-page"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Application error:", error)
  }, [error])

  return (
    <ConsumerStatePage variant="error" onRetry={reset} />
  )
}
