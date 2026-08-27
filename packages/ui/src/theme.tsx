"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"

export type ThemeMode = "light" | "dark" | "system"
export type ThemePreset = "default" | "neutral" | "violet" | "blue"
export type ThemeRadius = "small" | "medium" | "large" | "full"
export type BrandConfig = { name: string; logo?: string; icon?: string }
export type SaaSThemeConfig = {
  preset?: ThemePreset
  mode?: ThemeMode
  primary?: string
  accent?: string
  background?: string
  radius?: ThemeRadius
  brand?: BrandConfig
}
export const DEFAULT_THEME_CONFIG: Required<Pick<SaaSThemeConfig, "preset" | "mode" | "primary" | "accent" | "radius">> = { preset: "default", mode: "system", primary: "#6757e8", accent: "#91e0c0", radius: "medium" }

export function resolveThemeConfig(input: unknown): SaaSThemeConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_THEME_CONFIG }
  const raw = input as Record<string, unknown>
  const brand = raw.brand && typeof raw.brand === "object" ? raw.brand as Record<string, unknown> : undefined
  return {
    preset: typeof raw.preset === "string" && ["default", "neutral", "violet", "blue"].includes(raw.preset) ? raw.preset as ThemePreset : DEFAULT_THEME_CONFIG.preset,
    mode: typeof raw.mode === "string" && ["light", "dark", "system"].includes(raw.mode) ? raw.mode as ThemeMode : DEFAULT_THEME_CONFIG.mode,
    primary: typeof raw.primary === "string" ? raw.primary : DEFAULT_THEME_CONFIG.primary,
    accent: typeof raw.accent === "string" ? raw.accent : DEFAULT_THEME_CONFIG.accent,
    ...(typeof raw.background === "string" ? { background: raw.background } : {}),
    radius: typeof raw.radius === "string" && ["small", "medium", "large", "full"].includes(raw.radius) ? raw.radius as ThemeRadius : DEFAULT_THEME_CONFIG.radius,
    ...(brand ? { brand: { name: typeof brand.name === "string" && brand.name ? brand.name : "SaaS product", ...(typeof brand.logo === "string" ? { logo: brand.logo } : {}), ...(typeof brand.icon === "string" ? { icon: brand.icon } : {}) } } : {}),
  }
}

type ThemeContextValue = { mode: ThemeMode; resolvedMode: "light" | "dark"; setMode: (mode: ThemeMode) => void; config: SaaSThemeConfig }
const ThemeContext = createContext<ThemeContextValue>({ mode: "system", resolvedMode: "light", setMode: () => undefined, config: DEFAULT_THEME_CONFIG })
const radiusValues: Record<ThemeRadius, string> = { small: "0.625rem", medium: "0.875rem", large: "1.125rem", full: "1.5rem" }

function systemMode() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function themeVariables(config: SaaSThemeConfig): CSSProperties {
  return { ...(config.primary ? { "--sc-primary": config.primary } : {}), ...(config.accent ? { "--sc-accent": config.accent } : {}), ...(config.background ? { "--sc-background": config.background } : {}), ...(config.radius ? { "--sc-radius": radiusValues[config.radius] } : {}) } as CSSProperties
}

export function ThemeProvider({ children, config = {}, storageKey = "saas-core-theme" }: { children: ReactNode; config?: SaaSThemeConfig; storageKey?: string }) {
  const safeConfig = resolveThemeConfig(config)
  const initialMode = safeConfig.mode ?? "system"
  const [mode, setModeState] = useState<ThemeMode>(initialMode)
  const [resolvedMode, setResolvedMode] = useState<"light" | "dark">(initialMode === "system" ? "light" : initialMode)
  useEffect(() => { try { const stored = window.localStorage.getItem(storageKey); if (stored === "light" || stored === "dark" || stored === "system") setModeState(stored) } catch { /* optional preference */ } }, [storageKey])
  useEffect(() => { const update = () => setResolvedMode(mode === "system" ? systemMode() : mode); update(); if (mode !== "system") return; const media = window.matchMedia("(prefers-color-scheme: dark)"); media.addEventListener?.("change", update); return () => media.removeEventListener?.("change", update) }, [mode])
  useEffect(() => { document.documentElement.dataset.theme = mode; document.documentElement.style.colorScheme = resolvedMode }, [mode, resolvedMode])
  const setMode = useCallback((next: ThemeMode) => { setModeState(next); try { window.localStorage.setItem(storageKey, next) } catch { /* optional preference */ } }, [storageKey])
  const value = useMemo(() => ({ mode, resolvedMode, setMode, config: safeConfig }), [mode, resolvedMode, safeConfig, setMode])
  return <ThemeContext.Provider value={value}><div className="sc-theme-root" style={themeVariables(safeConfig)}>{children}</div></ThemeContext.Provider>
}

export function useTheme() { return useContext(ThemeContext) }
export function ThemeToggle() { const { mode, setMode } = useTheme(); return <button className="sc-icon-button" type="button" aria-label={`Theme: ${mode}. Change theme`} onClick={() => setMode(mode === "dark" ? "light" : mode === "light" ? "system" : "dark")}><span aria-hidden="true">{mode === "dark" ? "☾" : mode === "light" ? "☀" : "◐"}</span></button> }
