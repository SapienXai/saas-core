"use client"

import * as React from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { cn } from "../utils.js"

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = React.forwardRef<React.ElementRef<typeof CollapsiblePrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>>(({ className, ...props }, ref) => <CollapsiblePrimitive.Trigger ref={ref} className={cn("sc-collapsible-trigger", className)} {...props} />)
CollapsibleTrigger.displayName = CollapsiblePrimitive.Trigger.displayName
const CollapsibleContent = React.forwardRef<React.ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>, React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>>(({ className, ...props }, ref) => <CollapsiblePrimitive.CollapsibleContent ref={ref} className={cn("sc-collapsible-content", className)} {...props} />)
CollapsibleContent.displayName = CollapsiblePrimitive.CollapsibleContent.displayName

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
