"use client"

import * as React from "react"
import { OTPInput, OTPInputContext, type RenderProps } from "input-otp"
import { Dot } from "lucide-react"
import { cn } from "../utils.js"

const InputOTP = React.forwardRef<React.ElementRef<typeof OTPInput>, React.ComponentPropsWithoutRef<typeof OTPInput>>(({ className, containerClassName, ...props }, ref) => {
  const render = (props as { render?: (renderProps: RenderProps) => React.ReactNode }).render
  if (render) {
    const inputProps = Object.fromEntries(Object.entries(props).filter(([key]) => key !== "render" && key !== "children")) as Omit<React.ComponentPropsWithoutRef<typeof OTPInput>, "render" | "children">
    return <OTPInput ref={ref} containerClassName={cn("sc-input-otp-container", containerClassName)} className={cn("sc-input-otp", className)} {...inputProps} render={(renderProps) => <OTPInputContext.Provider value={renderProps}>{render(renderProps)}</OTPInputContext.Provider>} />
  }
  return <OTPInput ref={ref} containerClassName={cn("sc-input-otp-container", containerClassName)} className={cn("sc-input-otp", className)} {...props} />
})
InputOTP.displayName = "InputOTP"

const InputOTPGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("sc-input-otp-group", className)} {...props} />)
InputOTPGroup.displayName = "InputOTPGroup"

const InputOTPSlot = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { index: number }>(({ index, className, ...props }, ref) => {
  const context = React.useContext(OTPInputContext)
  const slot = context.slots[index]
  return <div ref={ref} className={cn("sc-input-otp-slot", slot?.isActive && "sc-input-otp-slot-active", className)} {...props}>{slot?.char}{slot?.hasFakeCaret && <span className="sc-input-otp-caret" aria-hidden="true" />}</div>
})
InputOTPSlot.displayName = "InputOTPSlot"

const InputOTPSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => <div ref={ref} role="separator" className="sc-input-otp-separator" {...props}><Dot aria-hidden="true" /></div>)
InputOTPSeparator.displayName = "InputOTPSeparator"

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
