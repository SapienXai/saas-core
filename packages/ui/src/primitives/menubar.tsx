"use client"

import * as React from "react"
import * as MenubarPrimitive from "@radix-ui/react-menubar"
import { Check, ChevronRight, Circle } from "lucide-react"
import { cn } from "../utils.js"

const Menubar = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Root>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>>(({ className, ...props }, ref) => <MenubarPrimitive.Root ref={ref} className={cn("sc-menubar", className)} {...props} />)
Menubar.displayName = MenubarPrimitive.Root.displayName
type MenubarMenuProps = React.ComponentProps<typeof MenubarPrimitive.Menu>
const MenubarMenu = (props: MenubarMenuProps) => <MenubarPrimitive.Menu {...props} />
const MenubarGroup = MenubarPrimitive.Group
const MenubarPortal = MenubarPrimitive.Portal
const MenubarSub = MenubarPrimitive.Sub
const MenubarRadioGroup = MenubarPrimitive.RadioGroup
const MenubarTrigger = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>>(({ className, ...props }, ref) => <MenubarPrimitive.Trigger ref={ref} className={cn("sc-menubar-trigger", className)} {...props} />)
const MenubarContent = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Content>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>>(({ className, ...props }, ref) => <MenubarPrimitive.Portal><MenubarPrimitive.Content ref={ref} className={cn("sc-menu-content", className)} {...props} /></MenubarPrimitive.Portal>)
const MenubarItem = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Item>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item>>(({ className, ...props }, ref) => <MenubarPrimitive.Item ref={ref} className={cn("sc-menu-item", className)} {...props} />)
const MenubarCheckboxItem = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>>(({ className, children, ...props }, ref) => <MenubarPrimitive.CheckboxItem ref={ref} className={cn("sc-menu-item sc-menu-item-check", className)} {...props}><span className="sc-menu-indicator"><MenubarPrimitive.ItemIndicator><Check aria-hidden="true" /></MenubarPrimitive.ItemIndicator></span>{children}</MenubarPrimitive.CheckboxItem>)
const MenubarRadioItem = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.RadioItem>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>>(({ className, children, ...props }, ref) => <MenubarPrimitive.RadioItem ref={ref} className={cn("sc-menu-item sc-menu-item-check", className)} {...props}><span className="sc-menu-indicator"><MenubarPrimitive.ItemIndicator><Circle aria-hidden="true" /></MenubarPrimitive.ItemIndicator></span>{children}</MenubarPrimitive.RadioItem>)
const MenubarLabel = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Label>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label>>(({ className, ...props }, ref) => <MenubarPrimitive.Label ref={ref} className={cn("sc-menu-label", className)} {...props} />)
const MenubarSeparator = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>>(({ className, ...props }, ref) => <MenubarPrimitive.Separator ref={ref} className={cn("sc-menu-separator", className)} {...props} />)
const MenubarSubTrigger = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger>>(({ className, children, ...props }, ref) => <MenubarPrimitive.SubTrigger ref={ref} className={cn("sc-menu-item", className)} {...props}>{children}<ChevronRight className="sc-menu-chevron" aria-hidden="true" /></MenubarPrimitive.SubTrigger>)
const MenubarSubContent = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.SubContent>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>>(({ className, ...props }, ref) => <MenubarPrimitive.SubContent ref={ref} className={cn("sc-menu-content", className)} {...props} />)
export { Menubar, MenubarMenu, MenubarGroup, MenubarPortal, MenubarSub, MenubarRadioGroup, MenubarTrigger, MenubarContent, MenubarItem, MenubarCheckboxItem, MenubarRadioItem, MenubarLabel, MenubarSeparator, MenubarSubTrigger, MenubarSubContent }
