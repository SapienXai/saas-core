"use client"

import type * as React from "react"
import * as ResizablePrimitive from "react-resizable-panels"
import { GripVertical } from "lucide-react"
import { cn } from "../utils.js"

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => <ResizablePrimitive.PanelGroup className={cn("sc-resizable-group", className)} {...props} />
const ResizablePanel = ResizablePrimitive.Panel
const ResizableHandle = ({ withHandle, className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & { withHandle?: boolean }) => <ResizablePrimitive.PanelResizeHandle className={cn("sc-resizable-handle", className)} {...props}>{withHandle && <span className="sc-resizable-grip"><GripVertical aria-hidden="true" /></span>}</ResizablePrimitive.PanelResizeHandle>
export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
