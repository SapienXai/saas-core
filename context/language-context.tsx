"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect, useCallback } from "react"
import {
  DEFAULT_LANGUAGE,
  getLocaleConfig,
  isSupportedLanguage,
  resolveLanguage,
  translate,
  translateMessage as translateEnglishMessage,
  type SupportedLanguage,
  type TranslationKey,
  type TranslationReplacements,
} from "@/i18n"

type LanguageContextType = {
  currentLang: SupportedLanguage
  setLanguage: (lang: string) => void
  getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string
  translateMessage: (message: string, replacements?: TranslationReplacements) => string
}

function getRecognizedLanguage(value: string | null): SupportedLanguage | null {
  if (!value) return null
  const baseLanguage = value.split(/[-_]/)[0]
  return isSupportedLanguage(baseLanguage) ? resolveLanguage(value) : null
}

// Create context with default values to prevent "undefined" errors
const defaultContextValue: LanguageContextType = {
  currentLang: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  getTranslation: (key) => key,
  translateMessage: (message) => message,
}

const LanguageContext = createContext<LanguageContextType>(defaultContextValue)

export function LanguageProvider({ children, initialLanguage = DEFAULT_LANGUAGE }: { children: React.ReactNode; initialLanguage?: SupportedLanguage }) {
  const [currentLang, setCurrentLang] = useState<SupportedLanguage>(initialLanguage)
  const [isClient, setIsClient] = useState(false)

  // Check if we're on the client side
  useEffect(() => {
    setIsClient(true)
  }, [])

  // The server resolves the initial language from the cookie or browser
  // preference. A URL parameter is an explicit per-page override.
  useEffect(() => {
    if (!isClient) return

    try {
      const urlParams = new URLSearchParams(window.location.search)
      const langParam = urlParams.get("lang")

      const urlLanguage = getRecognizedLanguage(langParam)
      if (urlLanguage) {
        setCurrentLang(urlLanguage)
      }
    } catch (e) {
      console.error("Error initializing language:", e)
    }
  }, [isClient])

  // Update HTML lang attribute when language changes
  useEffect(() => {
    if (!isClient) return

    document.documentElement.lang = getLocaleConfig(currentLang).intl
    document.documentElement.dir = getLocaleConfig(currentLang).direction
  }, [currentLang, isClient])

  const handleSetLanguage = (lang: string) => {
    const nextLanguage = getRecognizedLanguage(lang)
    if (nextLanguage) {
      setCurrentLang(nextLanguage)

      if (isClient) {
        try {
          // Persist only an explicit user selection. First-visit detection
          // remains based on the browser until the user changes the language.
          document.cookie = `lang=${nextLanguage}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`

          // Update URL with new language
          const params = new URLSearchParams(window.location.search)
          params.set("lang", nextLanguage)
          const query = params.toString()
          const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
          window.history.replaceState({ path: newUrl }, "", newUrl)
        } catch (e) {
          console.error("Error updating URL:", e)
        }
      }
    }
  }

  const getTranslation = useCallback((key: TranslationKey, replacements: TranslationReplacements = {}) =>
    translate(currentLang, key, replacements, { warnMissing: true }), [currentLang])
  const translateMessage = useCallback((message: string, replacements: TranslationReplacements = {}) =>
    translateEnglishMessage(currentLang, message, replacements), [currentLang])

  return (
    <LanguageContext.Provider value={{ currentLang, setLanguage: handleSetLanguage, getTranslation, translateMessage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  return context
}
