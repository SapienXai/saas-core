import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import * as AspectRatioPrimitive from "@radix-ui/react-aspect-ratio"
import * as AvatarPrimitive from "@radix-ui/react-avatar"
import * as LabelPrimitive from "@radix-ui/react-label"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import * as SeparatorPrimitive from "@radix-ui/react-separator"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../utils.js"

export const buttonVariants = cva(
  "sc-button inline-flex items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "sc-button-primary",
        primary: "sc-button-primary",
        secondary: "sc-button-secondary",
        outline: "sc-button-outline",
        ghost: "sc-button-ghost",
        destructive: "sc-button-destructive",
        link: "sc-button-link",
      },
      size: {
        sm: "sc-button-sm",
        md: "sc-button-md",
        default: "sc-button-md",
        lg: "sc-button-lg",
        icon: "sc-button-icon",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        aria-busy={loading || undefined}
        disabled={asChild ? undefined : disabled || loading}
        {...props}
      >
        {asChild ? children : <>{loading && <span className="sc-button-spinner" aria-hidden="true" />}{children}</>}
      </Comp>
    )
  },
)
Button.displayName = "Button"

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("sc-card", className)} {...props} />
))
Card.displayName = "Card"
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("sc-card-header", className)} {...props} />)
CardHeader.displayName = "CardHeader"
export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => <h2 ref={ref} className={cn("sc-card-title", className)} {...props} />)
CardTitle.displayName = "CardTitle"
export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => <p ref={ref} className={cn("sc-card-description", className)} {...props} />)
CardDescription.displayName = "CardDescription"
export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("sc-card-content", className)} {...props} />)
CardContent.displayName = "CardContent"
export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("sc-card-footer", className)} {...props} />)
CardFooter.displayName = "CardFooter"

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info"
export const badgeVariants = cva("sc-badge inline-flex items-center", {
  variants: { tone: { neutral: "sc-badge-neutral", success: "sc-badge-success", warning: "sc-badge-warning", danger: "sc-badge-danger", info: "sc-badge-info" } },
  defaultVariants: { tone: "neutral" },
})
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
export const Badge = ({ className, tone, ...props }: BadgeProps) => <span className={cn(badgeVariants({ tone }), className)} {...props} />

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn("sc-input", className)} {...props} />)
Input.displayName = "Input"
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => <textarea ref={ref} className={cn("sc-input sc-textarea", className)} {...props} />)
Textarea.displayName = "Textarea"
/** Use the Radix Select for interactive selection; keep this for native form-only cases. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => <select ref={ref} className={cn("sc-select-native", className)} {...props} />)
NativeSelect.displayName = "NativeSelect"

export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(({ className, ...props }, ref) => <LabelPrimitive.Root ref={ref} className={cn("sc-label", className)} {...props} />)
Label.displayName = LabelPrimitive.Root.displayName

export const Separator = React.forwardRef<React.ElementRef<typeof SeparatorPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => <SeparatorPrimitive.Root ref={ref} orientation={orientation} decorative={decorative} className={cn("sc-separator", orientation === "vertical" && "sc-separator-vertical", className)} {...props} />)
Separator.displayName = SeparatorPrimitive.Root.displayName

export const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>>(({ className, value = 0, ...props }, ref) => <ProgressPrimitive.Root ref={ref} value={value} className={cn("sc-progress", className)} {...props}><ProgressPrimitive.Indicator className="sc-progress-indicator" style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, value ?? 0))}%)` }} /></ProgressPrimitive.Root>)
Progress.displayName = ProgressPrimitive.Root.displayName

export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div aria-hidden="true" className={cn("sc-skeleton", className)} {...props} />
export const Alert = ({ className, tone = "info", ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: "info" | "success" | "warning" | "danger" }) => <div role="status" className={cn("sc-alert", `sc-alert-${tone}`, className)} {...props} />

export const Table = ({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) => <div className="sc-table-wrap"><table className={cn("sc-table", className)} {...props} /></div>
export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>((props, ref) => <thead ref={ref} {...props} />)
export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>((props, ref) => <tbody ref={ref} {...props} />)
export const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => <tfoot ref={ref} className={cn("sc-table-footer", className)} {...props} />)
export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => <tr ref={ref} className={cn("sc-table-row", className)} {...props} />)
export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => <th ref={ref} className={cn("sc-table-head", className)} {...props} />)
export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => <td ref={ref} className={cn("sc-table-cell", className)} {...props} />)
export const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(({ className, ...props }, ref) => <caption ref={ref} className={cn("sc-table-caption", className)} {...props} />)

export const AspectRatio = React.forwardRef<React.ElementRef<typeof AspectRatioPrimitive.Root>, React.ComponentPropsWithoutRef<typeof AspectRatioPrimitive.Root>>(({ className, ...props }, ref) => <AspectRatioPrimitive.Root ref={ref} className={cn("sc-aspect-ratio", className)} {...props} />)
AspectRatio.displayName = AspectRatioPrimitive.Root.displayName

export const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>>(({ className, ...props }, ref) => <AvatarPrimitive.Root ref={ref} className={cn("sc-avatar", className)} {...props} />)
Avatar.displayName = AvatarPrimitive.Root.displayName
export const AvatarImage = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Image>, React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>>(({ className, ...props }, ref) => <AvatarPrimitive.Image ref={ref} className={cn("sc-avatar-image", className)} {...props} />)
AvatarImage.displayName = AvatarPrimitive.Image.displayName
export const AvatarFallback = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Fallback>, React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>>(({ className, ...props }, ref) => <AvatarPrimitive.Fallback ref={ref} className={cn("sc-avatar-fallback", className)} {...props} />)
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>>(({ className, children, ...props }, ref) => <ScrollAreaPrimitive.Root ref={ref} className={cn("sc-scroll-area", className)} {...props}><ScrollAreaPrimitive.Viewport className="sc-scroll-viewport">{children}</ScrollAreaPrimitive.Viewport><ScrollAreaPrimitive.Scrollbar orientation="vertical" className="sc-scrollbar"><ScrollAreaPrimitive.Thumb className="sc-scroll-thumb" /></ScrollAreaPrimitive.Scrollbar><ScrollAreaPrimitive.Scrollbar orientation="horizontal" className="sc-scrollbar"><ScrollAreaPrimitive.Thumb className="sc-scroll-thumb" /></ScrollAreaPrimitive.Scrollbar><ScrollAreaPrimitive.Corner /></ScrollAreaPrimitive.Root>)
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

export const Breadcrumb = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => <nav aria-label="Breadcrumb" className={cn("sc-breadcrumb", className)} {...props} />

export const Form = ({ className, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => <form className={cn("sc-form", className)} {...props} />
export const FormItem = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("sc-form-item", className)} {...props} />
export const FormDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p className={cn("sc-form-description", className)} {...props} />
export const FormMessage = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p role="alert" className={cn("sc-form-message", className)} {...props} />

export const Pagination = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => <nav aria-label="Pagination" className={cn("sc-pagination", className)} {...props} />
export const PaginationContent = ({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) => <ul className={cn("sc-pagination-content", className)} {...props} />
export const PaginationItem = ({ className, ...props }: React.HTMLAttributes<HTMLLIElement>) => <li className={cn("sc-pagination-item", className)} {...props} />
export const PaginationLink = ({ className, ...props }: React.ComponentPropsWithoutRef<"a">) => <a className={cn("sc-pagination-link", className)} {...props} />

export type { VariantProps }
