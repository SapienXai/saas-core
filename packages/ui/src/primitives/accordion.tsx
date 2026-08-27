"use client"

import * as React from "react"
import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { ChevronDown } from "lucide-react"
import { cn } from "../utils.js"

const Accordion = AccordionPrimitive.Root
const AccordionItem = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Item>, React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>>(({ className, ...props }, ref) => <AccordionPrimitive.Item ref={ref} className={cn("sc-accordion-item", className)} {...props} />)
AccordionItem.displayName = AccordionPrimitive.Item.displayName
const AccordionTrigger = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>>(({ className, children, ...props }, ref) => <AccordionPrimitive.Header className="sc-accordion-header"><AccordionPrimitive.Trigger ref={ref} className={cn("sc-accordion-trigger", className)} {...props}>{children}<ChevronDown aria-hidden="true" className="sc-accordion-chevron" /></AccordionPrimitive.Trigger></AccordionPrimitive.Header>)
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName
const AccordionContent = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Content>, React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>>(({ className, children, ...props }, ref) => <AccordionPrimitive.Content ref={ref} className={cn("sc-accordion-content", className)} {...props}><div className="sc-accordion-content-inner">{children}</div></AccordionPrimitive.Content>)
AccordionContent.displayName = AccordionPrimitive.Content.displayName

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
