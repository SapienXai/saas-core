"use client"

import * as React from "react"
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"
import { Check, ChevronRight, Circle } from "lucide-react"
import { cn } from "../utils.js"

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuPortal = ContextMenuPrimitive.Portal
const ContextMenuGroup = ContextMenuPrimitive.Group
const ContextMenuSub = ContextMenuPrimitive.Sub
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup
const ContextMenuContent = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>>(({ className, ...props }, ref) => <ContextMenuPortal><ContextMenuPrimitive.Content ref={ref} className={cn("sc-menu-content", className)} {...props} /></ContextMenuPortal>)
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName
const ContextMenuItem = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Item>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>>(({ className, ...props }, ref) => <ContextMenuPrimitive.Item ref={ref} className={cn("sc-menu-item", className)} {...props} />)
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName
const ContextMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>>(({ className, children, ...props }, ref) => <ContextMenuPrimitive.CheckboxItem ref={ref} className={cn("sc-menu-item sc-menu-item-check", className)} {...props}><span className="sc-menu-indicator"><ContextMenuPrimitive.ItemIndicator><Check aria-hidden="true" /></ContextMenuPrimitive.ItemIndicator></span>{children}</ContextMenuPrimitive.CheckboxItem>)
const ContextMenuRadioItem = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.RadioItem>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>>(({ className, children, ...props }, ref) => <ContextMenuPrimitive.RadioItem ref={ref} className={cn("sc-menu-item sc-menu-item-check", className)} {...props}><span className="sc-menu-indicator"><ContextMenuPrimitive.ItemIndicator><Circle aria-hidden="true" /></ContextMenuPrimitive.ItemIndicator></span>{children}</ContextMenuPrimitive.RadioItem>)
const ContextMenuLabel = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Label>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>>(({ className, ...props }, ref) => <ContextMenuPrimitive.Label ref={ref} className={cn("sc-menu-label", className)} {...props} />)
const ContextMenuSeparator = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>>(({ className, ...props }, ref) => <ContextMenuPrimitive.Separator ref={ref} className={cn("sc-menu-separator", className)} {...props} />)
const ContextMenuSubTrigger = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>>(({ className, children, ...props }, ref) => <ContextMenuPrimitive.SubTrigger ref={ref} className={cn("sc-menu-item", className)} {...props}>{children}<ChevronRight className="sc-menu-chevron" aria-hidden="true" /></ContextMenuPrimitive.SubTrigger>)
const ContextMenuSubContent = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.SubContent>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>>(({ className, ...props }, ref) => <ContextMenuPrimitive.SubContent ref={ref} className={cn("sc-menu-content", className)} {...props} />)
export { ContextMenu, ContextMenuTrigger, ContextMenuPortal, ContextMenuGroup, ContextMenuSub, ContextMenuRadioGroup, ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem, ContextMenuRadioItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSubTrigger, ContextMenuSubContent }
