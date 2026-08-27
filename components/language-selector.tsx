"use client"

import { useLanguage } from "@/context/language-context"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Globe } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import ClientOnly from "./client-only"
import { localeConfig, type SupportedLanguage } from "@/i18n"

export function LanguageSelector() {
  const { currentLang, setLanguage, getTranslation } = useLanguage()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const languages = Object.entries(localeConfig) as Array<[SupportedLanguage, (typeof localeConfig)[SupportedLanguage]]>

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLanguageChange = (lang: string) => {
    if (lang === currentLang) return
    setLanguage(lang)
    // Refresh server-rendered sections (for example plan/domain pages) after
    // the language cookie is updated, while preserving the current route.
    router.refresh()
  }

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full">
        <Globe className="h-5 w-5" />
        <span className="sr-only">{getTranslation("language.label")}</span>
      </Button>
    )
  }

  return (
    <ClientOnly>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full flex items-center justify-center">
            <Globe className="h-5 w-5" />
            <span className="sr-only">{getTranslation("language.label")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="!bg-white !text-gray-900">
          {languages.map(([language, config]) => (
            <DropdownMenuItem
              key={language}
              className={currentLang === language ? "bg-muted" : ""}
              onClick={() => handleLanguageChange(language)}
            >
              <span className="mr-2">{config.flag}</span>
              <span>{config.nativeLabel}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  )
}
