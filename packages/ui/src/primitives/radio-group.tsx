"use client"

import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { Circle } from "lucide-react"
import { cn } from "../utils.js"

const RadioGroup = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Root>, React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>>(({ className, ...props }, ref) => <RadioGroupPrimitive.Root ref={ref} className={cn("sc-radio-group", className)} {...props} />)
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName
const RadioGroupItem = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Item>, React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>>(({ className, ...props }, ref) => <RadioGroupPrimitive.Item ref={ref} className={cn("sc-radio-item", className)} {...props}><RadioGroupPrimitive.Indicator className="sc-radio-indicator"><Circle aria-hidden="true" /></RadioGroupPrimitive.Indicator></RadioGroupPrimitive.Item>)
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName
export { RadioGroup, RadioGroupItem }
