"use client"

import { useRef, useState } from "react"
import Script from "next/script"

type Paddle = {
  Environment: { set(environment: "sandbox"): void }
  Initialize(options: { token: string; eventCallback(event: { name: string }): void }): void
  Checkout: { open(options: { transactionId: string; settings: { displayMode: "overlay"; allowLogout: boolean } }): void }
}

export default function PaddleCheckout({ transactionId, clientToken, environment, successPath, cancelPath }: {
  transactionId: string
  clientToken: string
  environment: "sandbox" | "live"
  successPath: string
  cancelPath: string
}) {
  const initialized = useRef(false)
  const completed = useRef(false)
  const [error, setError] = useState(false)

  function openCheckout() {
    if (initialized.current) return
    const paddle = (window as Window & { Paddle?: Paddle }).Paddle
    if (!paddle) {
      setError(true)
      return
    }
    initialized.current = true
    try {
      if (environment === "sandbox") paddle.Environment.set("sandbox")
      paddle.Initialize({
        token: clientToken,
        eventCallback(event) {
          if (event.name === "checkout.completed") {
            completed.current = true
            window.location.replace(successPath)
          } else if (event.name === "checkout.closed" && !completed.current) {
            window.location.replace(cancelPath)
          } else if (event.name === "checkout.error") {
            setError(true)
          }
        },
      })
      paddle.Checkout.open({ transactionId, settings: { displayMode: "overlay", allowLogout: false } })
    } catch {
      setError(true)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
      <Script src="https://cdn.paddle.com/paddle/v2/paddle.js" onReady={openCheckout} onError={() => setError(true)} />
      <div className="space-y-4 text-center">
        <p role="status">{error ? "Paddle checkout could not open." : "Opening Paddle checkout…"}</p>
        <a className="underline" href={cancelPath}>Return to your plan</a>
      </div>
    </main>
  )
}
