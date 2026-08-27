# Adding a language

The translation system has one source of truth for message shape and one registry for available locales.

To add a language:

1. Copy `i18n/locales/en.ts` to a new locale file, for example `i18n/locales/de.ts`, and translate the string values. Keep the same nested keys and placeholders such as `{name}`.
2. Add the locale metadata to `i18n/config.ts` (`label`, `nativeLabel`, `flag`, `intl`, `direction`, and `fallback`).
3. Register the new file in `i18n/messages.ts`.
4. Add the equivalent locale to `i18n/email-messages.ts` and `i18n/privacy-messages.ts`.
5. Run `npm run typecheck` and `npm run test:run`.

The type checker enforces message-key parity, and the i18n tests verify that every registered locale has the same keys, placeholders, and non-empty values across UI, email, and privacy messages. Language selectors read from `localeConfig`, so they do not need another code change.

Use `useLanguage().getTranslation(...)` in client components, `translateServer(...)` in server components, and the helpers in `i18n/format.ts` for locale-aware dates and numbers.
