"use client"

import { useState, type ComponentProps } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLanguage } from "@/context/language-context"

type PasswordFieldProps = ComponentProps<typeof Input> & {
  label: string
}

export function PasswordField({ label, className, id, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const { getTranslation } = useLanguage()

  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        aria-label={props["aria-label"] || label}
        className={cn("h-[42px] rounded-[10px] border-stone-200 bg-white px-3.5 pr-11 text-[13px] shadow-none placeholder:text-stone-400 focus-visible:border-stone-950 focus-visible:ring-4 focus-visible:ring-stone-950/10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-0 top-0 flex h-[42px] w-10 items-center justify-center rounded-r-[10px] text-stone-400 transition-colors hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950 focus-visible:ring-inset"
        aria-label={visible ? getTranslation("auth.hidePassword") : getTranslation("auth.showPassword")}
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
