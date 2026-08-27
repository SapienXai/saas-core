import type { Config } from "tailwindcss"

const saasCoreTailwindPreset: Partial<Config> = {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: "var(--sc-background)",
        foreground: "var(--sc-foreground)",
        card: "var(--sc-card)",
        border: "var(--sc-border)",
        input: "var(--sc-input)",
        ring: "var(--sc-ring)",
        primary: { DEFAULT: "var(--sc-primary)", foreground: "var(--sc-primary-foreground)" },
        secondary: { DEFAULT: "var(--sc-secondary)", foreground: "var(--sc-secondary-foreground)" },
        muted: { DEFAULT: "var(--sc-muted)", foreground: "var(--sc-muted-foreground)" },
        accent: { DEFAULT: "var(--sc-accent)", foreground: "var(--sc-accent-foreground)" },
        destructive: { DEFAULT: "var(--sc-destructive)", foreground: "var(--sc-destructive-foreground)" },
      },
      borderRadius: { lg: "var(--sc-radius)", md: "var(--sc-radius-sm)", sm: "calc(var(--sc-radius-sm) - 2px)" },
    },
  },
}

export default saasCoreTailwindPreset
