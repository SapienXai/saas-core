"use client"

import * as React from "react"
import type { DialogProps } from "@radix-ui/react-dialog"
import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"
import { cn } from "../utils.js"
import { Dialog, DialogContent, DialogTitle } from "./dialog.js"

const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, React.ComponentPropsWithoutRef<typeof CommandPrimitive>>(({ className, ...props }, ref) => <CommandPrimitive ref={ref} className={cn("sc-command", className)} {...props} />)
Command.displayName = CommandPrimitive.displayName
const CommandDialog = ({ children, ...props }: DialogProps) => <Dialog {...props}><DialogContent className="sc-command-dialog"><DialogTitle className="sc-sr-only">Command menu</DialogTitle><Command>{children}</Command></DialogContent></Dialog>
const CommandInput = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Input>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>>(({ className, ...props }, ref) => <div className="sc-command-input-wrap"><Search aria-hidden="true" /><CommandPrimitive.Input ref={ref} className={cn("sc-command-input", className)} {...props} /></div>)
CommandInput.displayName = CommandPrimitive.Input.displayName
const CommandList = React.forwardRef<React.ElementRef<typeof CommandPrimitive.List>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(({ className, ...props }, ref) => <CommandPrimitive.List ref={ref} className={cn("sc-command-list", className)} {...props} />)
CommandList.displayName = CommandPrimitive.List.displayName
const CommandEmpty = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Empty>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>>(({ className, ...props }, ref) => <CommandPrimitive.Empty ref={ref} className={cn("sc-command-empty", className)} {...props} />)
CommandEmpty.displayName = CommandPrimitive.Empty.displayName
const CommandGroup = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Group>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(({ className, ...props }, ref) => <CommandPrimitive.Group ref={ref} className={cn("sc-command-group", className)} {...props} />)
CommandGroup.displayName = CommandPrimitive.Group.displayName
const CommandSeparator = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>>(({ className, ...props }, ref) => <CommandPrimitive.Separator ref={ref} className={cn("sc-command-separator", className)} {...props} />)
CommandSeparator.displayName = CommandPrimitive.Separator.displayName
const CommandItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(({ className, ...props }, ref) => <CommandPrimitive.Item ref={ref} className={cn("sc-command-item", className)} {...props} />)
CommandItem.displayName = CommandPrimitive.Item.displayName
const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn("sc-menu-shortcut", className)} {...props} />
export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator }
