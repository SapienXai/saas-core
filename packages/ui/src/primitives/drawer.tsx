"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"
import { cn } from "../utils.js"

const Drawer = ({ shouldScaleBackground = true, ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) => <DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
Drawer.displayName = "Drawer"
const DrawerTrigger = DrawerPrimitive.Trigger
const DrawerPortal = DrawerPrimitive.Portal
const DrawerClose = DrawerPrimitive.Close
const DrawerOverlay = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>>(({ className, ...props }, ref) => <DrawerPrimitive.Overlay ref={ref} className={cn("sc-overlay", "sc-drawer-overlay", className)} {...props} />)
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName
const DrawerContent = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>>(({ className, children, ...props }, ref) => <DrawerPortal><DrawerOverlay /><DrawerPrimitive.Content ref={ref} className={cn("sc-drawer-content", className)} {...props}><div className="sc-drawer-handle" aria-hidden="true" />{children}</DrawerPrimitive.Content></DrawerPortal>)
DrawerContent.displayName = "DrawerContent"
const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-dialog-header", "sc-drawer-header", className)} {...props} />
const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-dialog-footer", "sc-drawer-footer", className)} {...props} />
const DrawerTitle = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>>(({ className, ...props }, ref) => <DrawerPrimitive.Title ref={ref} className={cn("sc-dialog-title", className)} {...props} />)
const DrawerDescription = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>>(({ className, ...props }, ref) => <DrawerPrimitive.Description ref={ref} className={cn("sc-dialog-description", className)} {...props} />)

export { Drawer, DrawerPortal, DrawerOverlay, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription }
