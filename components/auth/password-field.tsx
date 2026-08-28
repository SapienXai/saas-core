"use client"

import { useState, type ComponentProps } from "react"
import { Eye, EyeOff, LockKeyhole } from "lucide-react"
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
    <div className="auth-input-shell">
      <LockKeyhole className="auth-input-icon" aria-hidden="true" strokeWidth={1.75} />
      <Input
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        aria-label={props["aria-label"] || label}
        className={cn("auth-input", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="auth-password-toggle"
        aria-label={visible ? getTranslation("auth.hidePassword") : getTranslation("auth.showPassword")}
        aria-pressed={visible}
      >
        {visible ? <EyeOff aria-hidden="true" strokeWidth={1.75} /> : <Eye aria-hidden="true" strokeWidth={1.75} />}
      </button>
    </div>
  )
}
