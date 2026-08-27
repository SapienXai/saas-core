"use client"

import { useEffect, useState } from "react"
import type { CSSProperties } from "react"
import { useLanguage } from "@/context/language-context"

export type HowItWorksStep = {
  number: string
  title: string
  text: string
}

function StepMicroVisual({ number, publishedLabel }: { number: string; publishedLabel: string }) {
  if (number === "01") {
    return (
      <div className="marketing-step-micro marketing-step-micro-profile" aria-hidden="true">
        <span className="marketing-step-profile-avatar">R</span>
        <span className="marketing-step-profile-copy"><i /><i /></span>
        <span className="marketing-step-profile-check">✓</span>
        <span className="marketing-step-profile-row"><i /><i /></span>
      </div>
    )
  }

  if (number === "02") {
    return (
      <div className="marketing-step-micro marketing-step-micro-publish" aria-hidden="true">
        <span className="marketing-step-url-chip">your-restaurant.reservevia.com</span>
        <span className="marketing-step-publish-status"><i /> {publishedLabel}</span>
        <span className="marketing-step-share-mark">↗</span>
      </div>
    )
  }

  return (
    <div className="marketing-step-micro marketing-step-micro-bookings" aria-hidden="true">
      <span className="marketing-step-booking-card"><i>7:00</i><b /><em /></span>
      <span className="marketing-step-booking-card"><i>7:30</i><b /><em /></span>
      <span className="marketing-step-booking-card"><i>8:15</i><b /><em /></span>
    </div>
  )
}

export function HowItWorksSteps({ steps }: { steps: HowItWorksStep[] }) {
  const { getTranslation } = useLanguage()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const stateClassName = [
    "marketing-steps-grid",
    isVisible ? "is-visible" : "",
  ].filter(Boolean).join(" ")

  return (
    <div className={stateClassName}>
      <span className="marketing-steps-progress" aria-hidden="true"><span /></span>
      {steps.map((step, index) => (
        <article
          className={`marketing-step marketing-step-${step.number}`}
          key={step.number}
          style={{ "--marketing-step-delay": `${index * 90}ms` } as CSSProperties}
        >
          <div className="marketing-step-topline">
            <span className="marketing-step-number">{step.number}</span>
            <span className="marketing-step-status" aria-hidden="true" />
          </div>
          <StepMicroVisual number={step.number} publishedLabel={getTranslation("marketing.published")} />
          <div className="marketing-step-copy">
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </div>
        </article>
      ))}
    </div>
  )
}
