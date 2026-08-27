"use client"

import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { DayButton, DayPicker, type DayPickerProps } from "react-day-picker"
import { cn } from "../utils.js"

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  return <DayPicker showOutsideDays={showOutsideDays} className={cn("sc-calendar", className)} classNames={{ ...classNames, months: cn("sc-calendar-months", classNames?.months), month: cn("sc-calendar-month", classNames?.month), month_caption: cn("sc-calendar-caption", classNames?.month_caption), caption_label: cn("sc-calendar-caption-label", classNames?.caption_label), nav: cn("sc-calendar-nav", classNames?.nav), button_previous: cn("sc-calendar-nav-button", classNames?.button_previous), button_next: cn("sc-calendar-nav-button", classNames?.button_next), month_grid: cn("sc-calendar-grid", classNames?.month_grid), weekdays: cn("sc-calendar-weekdays", classNames?.weekdays), weekday: cn("sc-calendar-weekday", classNames?.weekday), week: cn("sc-calendar-week", classNames?.week), day: cn("sc-calendar-day", classNames?.day), day_button: cn("sc-calendar-day-button", classNames?.day_button), today: cn("sc-calendar-today", classNames?.today), selected: cn("sc-calendar-selected", classNames?.selected), outside: cn("sc-calendar-outside", classNames?.outside), disabled: cn("sc-calendar-disabled", classNames?.disabled), hidden: cn("sc-calendar-hidden", classNames?.hidden), ...classNames }} components={{ Chevron: ({ orientation, className, ...rest }) => orientation === "left" ? <ChevronLeft className={cn("sc-calendar-chevron", className)} {...rest} /> : orientation === "right" ? <ChevronRight className={cn("sc-calendar-chevron", className)} {...rest} /> : <ChevronDown className={cn("sc-calendar-chevron", className)} {...rest} />, DayButton: CalendarDayButton }} {...props} />
}

function CalendarDayButton({ className, day, modifiers, ...props }: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { if (modifiers.focused) ref.current?.focus() }, [modifiers.focused])
  return <button ref={ref} type="button" data-day={day.date.toLocaleDateString()} data-selected={modifiers.selected || undefined} className={cn("sc-calendar-day-button", modifiers.selected && "sc-calendar-day-selected", className)} {...props} />
}
CalendarDayButton.displayName = "CalendarDayButton"
