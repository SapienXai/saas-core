"use client"

import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../utils.js"

const toggleVariants = cva("sc-toggle inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring)] disabled:pointer-events-none disabled:opacity-50", { variants: { variant: { default: "sc-toggle-default", outline: "sc-toggle-outline" }, size: { default: "sc-toggle-md", sm: "sc-toggle-sm", lg: "sc-toggle-lg" } }, defaultVariants: { variant: "default", size: "default" } })
const Toggle = React.forwardRef<React.ElementRef<typeof TogglePrimitive.Root>, React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>>(({ className, variant, size, ...props }, ref) => <TogglePrimitive.Root ref={ref} className={cn(toggleVariants({ variant, size }), className)} {...props} />)
Toggle.displayName = TogglePrimitive.Root.displayName
const ToggleGroup = React.forwardRef<React.ElementRef<typeof ToggleGroupPrimitive.Root>, React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>>(({ className, ...props }, ref) => <ToggleGroupPrimitive.Root ref={ref} className={cn("sc-toggle-group", className)} {...props} />)
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName
const ToggleGroupItem = React.forwardRef<React.ElementRef<typeof ToggleGroupPrimitive.Item>, React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>>(({ className, variant, size, ...props }, ref) => <ToggleGroupPrimitive.Item ref={ref} className={cn(toggleVariants({ variant, size }), className)} {...props} />)
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName
export { Toggle, ToggleGroup, ToggleGroupItem, toggleVariants }
