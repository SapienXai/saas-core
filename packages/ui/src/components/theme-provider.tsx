"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

type Theme = string

export type ThemeProviderProps = {
  children: ReactNode
  forcedTheme?: Theme
  defaultTheme?: Theme
  themes?: string[]
  attribute?: string | string[]
  value?: Record<string, string>
  enableSystem?: boolean
  enableColorScheme?: boolean
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeContextValue = {
  theme: Theme | undefined
  setTheme: (theme: Theme) => void
  forcedTheme?: Theme
  resolvedTheme: Theme | undefined
  themes: string[]
  systemTheme?: "light" | "dark"
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: undefined,
  setTheme: () => undefined,
  resolvedTheme: undefined,
  themes: [],
})

function applyTheme(attribute: string | string[], theme: string, value: Record<string, string> | undefined, themes: string[], enableColorScheme: boolean) {
  const root = document.documentElement
  const resolvedValue = value?.[theme] || theme
  const attributes = Array.isArray(attribute) ? attribute : [attribute]

  for (const currentAttribute of attributes) {
    if (currentAttribute === "class") {
      root.classList.remove(...themes.map((item) => value?.[item] || item))
      if (resolvedValue) root.classList.add(resolvedValue)
    } else if (resolvedValue) {
      root.setAttribute(currentAttribute, resolvedValue)
    } else {
      root.removeAttribute(currentAttribute)
    }
  }

  if (enableColorScheme) root.style.colorScheme = theme === "dark" ? "dark" : "light"
}

export function ThemeProvider({
  children,
  forcedTheme,
  defaultTheme = "system",
  themes = ["light", "dark"],
  attribute = "data-theme",
  value,
  enableSystem = true,
  enableColorScheme = true,
  storageKey = "theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light")

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme)
    try {
      window.localStorage.setItem(storageKey, nextTheme)
    } catch {
      // Storage can be unavailable in private browsing or restricted embeds.
    }
  }, [storageKey])

  useEffect(() => {
    try {
      const storedTheme = window.localStorage.getItem(storageKey)
      if (storedTheme) setThemeState(storedTheme)
    } catch {
      // Keep the configured default when storage is unavailable.
    }
  }, [storageKey])

  useEffect(() => {
    if (!enableSystem) return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light")
    updateSystemTheme()
    media.addEventListener?.("change", updateSystemTheme)
    return () => media.removeEventListener?.("change", updateSystemTheme)
  }, [enableSystem])

  const resolvedTheme = forcedTheme || (theme === "system" && enableSystem ? systemTheme : theme)

  useEffect(() => {
    if (resolvedTheme) applyTheme(attribute, resolvedTheme, value, themes, enableColorScheme)
  }, [attribute, enableColorScheme, resolvedTheme, themes, value])

  const contextValue = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme,
    forcedTheme,
    resolvedTheme,
    themes: enableSystem ? [...themes, "system"] : themes,
    systemTheme: enableSystem ? systemTheme : undefined,
  }), [enableSystem, forcedTheme, resolvedTheme, setTheme, systemTheme, theme, themes])

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
