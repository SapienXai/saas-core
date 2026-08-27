"use client"

import * as React from "react"
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu"
import { ChevronDown } from "lucide-react"
import { cn } from "../utils.js"

const NavigationMenu = React.forwardRef<React.ElementRef<typeof NavigationMenuPrimitive.Root>, React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Root>>(({ className, children, ...props }, ref) => <NavigationMenuPrimitive.Root ref={ref} className={cn("sc-navigation-menu", className)} {...props}>{children}<NavigationMenuPrimitive.Viewport className="sc-navigation-viewport" /></NavigationMenuPrimitive.Root>)
NavigationMenu.displayName = NavigationMenuPrimitive.Root.displayName
const NavigationMenuList = React.forwardRef<React.ElementRef<typeof NavigationMenuPrimitive.List>, React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.List>>(({ className, ...props }, ref) => <NavigationMenuPrimitive.List ref={ref} className={cn("sc-navigation-list", className)} {...props} />)
const NavigationMenuItem = NavigationMenuPrimitive.Item
const NavigationMenuLink = NavigationMenuPrimitive.Link
const NavigationMenuTrigger = React.forwardRef<React.ElementRef<typeof NavigationMenuPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Trigger>>(({ className, children, ...props }, ref) => <NavigationMenuPrimitive.Trigger ref={ref} className={cn("sc-navigation-trigger", className)} {...props}>{children}<ChevronDown className="sc-navigation-chevron" aria-hidden="true" /></NavigationMenuPrimitive.Trigger>)
const NavigationMenuContent = React.forwardRef<React.ElementRef<typeof NavigationMenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Content>>(({ className, ...props }, ref) => <NavigationMenuPrimitive.Content ref={ref} className={cn("sc-navigation-content", className)} {...props} />)
const NavigationMenuIndicator = React.forwardRef<React.ElementRef<typeof NavigationMenuPrimitive.Indicator>, React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Indicator>>(({ className, ...props }, ref) => <NavigationMenuPrimitive.Indicator ref={ref} className={cn("sc-navigation-indicator", className)} {...props} />)
export { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuLink, NavigationMenuTrigger, NavigationMenuContent, NavigationMenuIndicator }
