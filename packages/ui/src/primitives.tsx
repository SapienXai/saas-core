import { forwardRef, type ButtonHTMLAttributes, type ComponentPropsWithoutRef, type HTMLAttributes, type ImgHTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react"
import { cn } from "./utils.js"

export type ButtonVariant = "default" | "primary" | "secondary" | "outline" | "ghost" | "destructive" | "link"
export type ButtonSize = "sm" | "md" | "default" | "lg" | "icon"
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }>(({ className, variant = "primary", size = "md", loading = false, disabled, children, ...props }, ref) => <button ref={ref} className={cn("sc-button", `sc-button-${variant === "default" ? "primary" : variant}`, `sc-button-${size === "default" ? "md" : size}`, className)} aria-busy={loading || undefined} disabled={disabled || loading} {...props}>{loading && <span className="sc-button-spinner" aria-hidden="true" />}{children}</button>)
Button.displayName = "Button"
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("sc-card", className)} {...props} />)
Card.displayName = "Card"
export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-card-header", className)} {...props} />
export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => <h2 className={cn("sc-card-title", className)} {...props} />
export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn("sc-card-description", className)} {...props} />
export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-card-content", className)} {...props} />
export const CardFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-card-footer", className)} {...props} />
export const Badge = ({ className, tone = "neutral", children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" | "info"; children?: ReactNode }) => <span className={cn("sc-badge", `sc-badge-${tone}`, className)} {...props}>{children}</span>
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn("sc-input", className)} {...props} />)
Input.displayName = "Input"
export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn("sc-label", className)} {...props} />
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => <textarea ref={ref} className={cn("sc-input sc-textarea", className)} {...props} />)
Textarea.displayName = "Textarea"
export const Separator = ({ className, orientation = "horizontal", ...props }: HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }) => <div role="separator" aria-orientation={orientation} className={cn("sc-separator", orientation === "vertical" && "sc-separator-vertical", className)} {...props} />
export const Progress = ({ className, value = 0, ...props }: HTMLAttributes<HTMLDivElement> & { value?: number }) => <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className={cn("sc-progress", className)} {...props}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
export const Skeleton = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div aria-hidden="true" className={cn("sc-skeleton", className)} {...props} />
export const Alert = ({ className, tone = "info", ...props }: HTMLAttributes<HTMLDivElement> & { tone?: "info" | "success" | "warning" | "danger" }) => <div role="status" className={cn("sc-alert", `sc-alert-${tone}`, className)} {...props} />
export const Table = ({ className, ...props }: HTMLAttributes<HTMLTableElement>) => <div className="sc-table-wrap"><table className={cn("sc-table", className)} {...props} /></div>
export const TableHeader = (props: HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />
export const TableBody = (props: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />
export const TableRow = ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("sc-table-row", className)} {...props} />
export const TableHead = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => <th className={cn("sc-table-head", className)} {...props} />
export const TableCell = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => <td className={cn("sc-table-cell", className)} {...props} />
export const Dialog = ({ open = true, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { open?: boolean }) => open ? <div className="sc-dialog-backdrop"><div role="dialog" aria-modal="true" className={cn("sc-dialog", className)} {...props}>{children}</div></div> : null
export const DialogTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => <h2 className={cn("sc-dialog-title", className)} {...props} />
export const DialogDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn("sc-dialog-description", className)} {...props} />
export type SelectProps = ComponentPropsWithoutRef<"select">
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => <select ref={ref} className={cn("sc-input", className)} {...props} />)
Select.displayName = "Select"

/** Generic equivalents for the production-proven primitive breadth reviewed from ReserveVia. */
export const AspectRatio = ({ ratio = 1, style, className, ...props }: HTMLAttributes<HTMLDivElement> & { ratio?: number }) => <div className={cn("sc-aspect-ratio", className)} style={{ aspectRatio: ratio, ...style }} {...props} />
export const Avatar = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <span className={cn("sc-avatar sc-avatar-lg", className)} {...props} />
export const AvatarImage = ({ className, ...props }: ImgHTMLAttributes<HTMLImageElement>) => <img className={cn("sc-avatar-image", className)} {...props} />
export const AvatarFallback = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => <span className={cn("sc-avatar-fallback", className)} {...props} />
export const Breadcrumb = ({ className, ...props }: HTMLAttributes<HTMLElement>) => <nav aria-label="Breadcrumb" className={cn("sc-breadcrumb", className)} {...props} />
export const Calendar = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <Input ref={ref} type="date" className={cn("sc-calendar", className)} {...props} />)
Calendar.displayName = "Calendar"
export const Carousel = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="region" aria-roledescription="carousel" className={cn("sc-carousel", className)} {...props} />
export const ChartContainer = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-chart", className)} {...props} />
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} type="checkbox" className={cn("sc-checkbox", className)} {...props} />)
Checkbox.displayName = "Checkbox"
export const Collapsible = ({ open, className, ...props }: HTMLAttributes<HTMLDetailsElement> & { open?: boolean }) => <details open={open} className={cn("sc-collapsible", className)} {...props} />
export const CollapsibleTrigger = ({ className, ...props }: HTMLAttributes<HTMLElement>) => <summary className={cn("sc-collapsible-trigger", className)} {...props} />
export const CollapsibleContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-collapsible-content", className)} {...props} />
export const Accordion = Collapsible
export const AccordionItem = ({ className, ...props }: HTMLAttributes<HTMLDetailsElement>) => <details className={cn("sc-accordion-item", className)} {...props} />
export const AccordionTrigger = CollapsibleTrigger
export const AccordionContent = CollapsibleContent
export const Command = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="search" className={cn("sc-command", className)} {...props} />
export const ContextMenu = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-context-menu", className)} {...props} />
export const DropdownMenu = ({ className, ...props }: HTMLAttributes<HTMLDetailsElement>) => <details className={cn("sc-dropdown", className)} {...props} />
export const DropdownMenuTrigger = ({ className, ...props }: HTMLAttributes<HTMLElement>) => <summary className={cn("sc-dropdown-trigger", className)} {...props} />
export const DropdownMenuContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-dropdown-content", className)} {...props} />
export const DropdownMenuItem = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" className={cn("sc-dropdown-item", className)} {...props} />
export const Drawer = Dialog
export const DrawerContent = Dialog
export const Sheet = Dialog
export const SheetContent = Dialog
export const SheetTitle = DialogTitle
export const SheetDescription = DialogDescription
export const AlertDialog = Dialog
export const AlertDialogContent = Dialog
export const AlertDialogTitle = DialogTitle
export const AlertDialogDescription = DialogDescription
export const HoverCard = ({ className, ...props }: HTMLAttributes<HTMLDetailsElement>) => <details className={cn("sc-hover-card", className)} {...props} />
export const Menubar = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="menubar" className={cn("sc-menubar", className)} {...props} />
export const NavigationMenu = ({ className, ...props }: HTMLAttributes<HTMLElement>) => <nav className={cn("sc-navigation-menu", className)} {...props} />
export const Pagination = ({ className, ...props }: HTMLAttributes<HTMLElement>) => <nav aria-label="Pagination" className={cn("sc-pagination", className)} {...props} />
export const PaginationContent = ({ className, ...props }: HTMLAttributes<HTMLUListElement>) => <ul className={cn("sc-pagination-content", className)} {...props} />
export const PaginationItem = ({ className, ...props }: HTMLAttributes<HTMLLIElement>) => <li className={cn("sc-pagination-item", className)} {...props} />
export const PaginationLink = ({ className, ...props }: ComponentPropsWithoutRef<"a">) => <a className={cn("sc-pagination-link", className)} {...props} />
export const Popover = ({ open, className, ...props }: HTMLAttributes<HTMLDetailsElement> & { open?: boolean }) => <details open={open} className={cn("sc-popover", className)} {...props} />
export const PopoverTrigger = ({ className, ...props }: HTMLAttributes<HTMLElement>) => <summary className={cn("sc-popover-trigger", className)} {...props} />
export const PopoverContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-popover-content", className)} {...props} />
export const RadioGroup = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="radiogroup" className={cn("sc-radio-group", className)} {...props} />
export const RadioGroupItem = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} type="radio" className={cn("sc-radio", className)} {...props} />)
RadioGroupItem.displayName = "RadioGroupItem"
export const ResizablePanelGroup = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-resizable-group", className)} {...props} />
export const ResizablePanel = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-resizable-panel", className)} {...props} />
export const ResizableHandle = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="separator" className={cn("sc-resizable-handle", className)} {...props} />
export const ScrollArea = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-scroll-area", className)} {...props} />
export const Slider = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} type="range" className={cn("sc-slider", className)} {...props} />)
Slider.displayName = "Slider"
export const Switch = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} type="checkbox" role="switch" className={cn("sc-switch", className)} {...props} />)
Switch.displayName = "Switch"
export const Tabs = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-tabs", className)} {...props} />
export const TabsList = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="tablist" className={cn("sc-tabs-list", className)} {...props} />
export const TabsTrigger = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" role="tab" className={cn("sc-tabs-trigger", className)} {...props} />
export const TabsContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="tabpanel" className={cn("sc-tabs-content", className)} {...props} />
export const Toast = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="status" className={cn("sc-toast", className)} {...props} />
export const ToastTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("sc-toast-title", className)} {...props} />
export const ToastDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn("sc-toast-description", className)} {...props} />
export const Toaster = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div aria-live="polite" className={cn("sc-toaster", className)} {...props} />
export const Tooltip = ({ content, children, className, ...props }: HTMLAttributes<HTMLSpanElement> & { content?: string; children?: ReactNode }) => <span title={content} className={cn("sc-tooltip", className)} {...props}>{children}</span>
export const TooltipProvider = ({ children }: { children?: ReactNode }) => <>{children}</>
export const TooltipTrigger = ({ className, ...props }: HTMLAttributes<HTMLElement>) => <span className={cn("sc-tooltip-trigger", className)} {...props} />
export const TooltipContent = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => <span role="tooltip" className={cn("sc-tooltip-content", className)} {...props} />
export const Toggle = ({ pressed, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) => <button type="button" aria-pressed={pressed} className={cn("sc-toggle", className)} {...props} />
export const ToggleGroup = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div role="group" className={cn("sc-toggle-group", className)} {...props} />
export const InputOTP = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <Input ref={ref} inputMode="numeric" autoComplete="one-time-code" className={cn("sc-input-otp", className)} {...props} />)
InputOTP.displayName = "InputOTP"
export const Form = ({ className, ...props }: HTMLAttributes<HTMLFormElement>) => <form className={cn("sc-form", className)} {...props} />
export const FormItem = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-form-item", className)} {...props} />
export const FormDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn("sc-form-description", className)} {...props} />
export const FormMessage = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p role="alert" className={cn("sc-form-message", className)} {...props} />
export const AspectRatioFallback = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-aspect-ratio-fallback", className)} {...props} />
