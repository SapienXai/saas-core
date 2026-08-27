export type LocaleMessages<Shape extends object> = {
  [K in keyof Shape]: Shape[K] extends string
    ? string
    : Shape[K] extends object
      ? LocaleMessages<Shape[K]>
      : Shape[K]
}

export type StringLeafKeys<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends object
      ? `${K}.${StringLeafKeys<T[K]>}`
      : never
}[keyof T & string]

export type TranslationReplacements = Record<string, string | number>

export type LocaleDirection = "ltr" | "rtl"
