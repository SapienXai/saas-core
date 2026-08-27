"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"
import { cn } from "../utils.js"

const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(({ className, ...props }, ref) => <CheckboxPrimitive.Root ref={ref} className={cn("sc-checkbox", className)} {...props}><CheckboxPrimitive.Indicator className="sc-checkbox-indicator"><Check aria-hidden="true" /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>)
Checkbox.displayName = CheckboxPrimitive.Root.displayName
export { Checkbox }
