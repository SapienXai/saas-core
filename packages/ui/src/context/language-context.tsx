"use client"

import { createContext, useContext, type ReactNode } from "react"

type LanguageContextValue = {
  getTranslation: (key: string) => string
  translateMessage: (value: string) => string
}

const defaultValue: LanguageContextValue = {
  getTranslation: (key) => key,
  translateMessage: (value) => value,
}

const LanguageContext = createContext(defaultValue)

export function LanguageProvider({ children, translate = defaultValue.getTranslation }: { children: ReactNode; translate?: (key: string) => string }) {
  return <LanguageContext.Provider value={{ getTranslation: translate, translateMessage: translate }}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  return useContext(LanguageContext)
}
