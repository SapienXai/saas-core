"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"
import { cn } from "../utils.js"

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetPortal = SheetPrimitive.Portal
const SheetOverlay = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>>(({ className, ...props }, ref) => <SheetPrimitive.Overlay ref={ref} className={cn("sc-overlay", "sc-sheet-overlay", className)} {...props} />)
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName
const sheetVariants = cva("sc-sheet-content", { variants: { side: { top: "sc-sheet-top", bottom: "sc-sheet-bottom", left: "sc-sheet-left", right: "sc-sheet-right" } }, defaultVariants: { side: "right" } })
type SheetContentProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & VariantProps<typeof sheetVariants> & { portalContainer?: HTMLElement | null; showClose?: boolean }
const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(({ side = "right", className, children, portalContainer, showClose = true, ...props }, ref) => <SheetPortal container={portalContainer ?? undefined}><SheetOverlay /><SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>{children}{showClose && <SheetPrimitive.Close className="sc-dialog-close" aria-label="Close panel"><X aria-hidden="true" /></SheetPrimitive.Close>}</SheetPrimitive.Content></SheetPortal>)
SheetContent.displayName = SheetPrimitive.Content.displayName
const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-dialog-header", className)} {...props} />
const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-dialog-footer", className)} {...props} />
const SheetTitle = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Title>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>>(({ className, ...props }, ref) => <SheetPrimitive.Title ref={ref} className={cn("sc-dialog-title", className)} {...props} />)
const SheetDescription = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Description>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>>(({ className, ...props }, ref) => <SheetPrimitive.Description ref={ref} className={cn("sc-dialog-description", className)} {...props} />)

export { Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, sheetVariants }
