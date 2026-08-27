"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cn } from "../utils.js"

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(({ className, ...props }, ref) => <SwitchPrimitive.Root ref={ref} className={cn("sc-switch", className)} {...props}><SwitchPrimitive.Thumb className="sc-switch-thumb" /></SwitchPrimitive.Root>)
Switch.displayName = SwitchPrimitive.Root.displayName
export { Switch }
