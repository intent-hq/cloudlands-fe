/**
 * Renderer locale service — owns the active Paraglide locale.
 *
 * Importing this module routes every `m.*()` call through a module-level
 * active locale (via `overwriteGetLocale`), so switching the language never
 * needs a page reload. The user-preferences persistence middleware calls
 * `applyLanguagePreference()` on boot hydration and whenever
 * `userPreferences/setLanguagePreference` is dispatched; components re-render
 * through the `{#key}` block on the resolved locale in `+layout.svelte`.
 *
 * Locale resolution is catalog-driven (`$shared/i18n/locale-matcher`):
 * explicit preference → system locale best-match → base locale.
 */
import { baseLocale, locales, overwriteGetLocale } from '$shared/paraglide/runtime.js';
import { resolveLocale } from '$shared/i18n/locale-matcher';
import { loadDateFnsLocale } from '$shared/i18n/formatters';

export type AppLocale = (typeof locales)[number];

let activeLocale: AppLocale = baseLocale;

// Route every m.*() call through the service-owned active locale.
overwriteGetLocale(() => activeLocale);

/**
 * OS/system locale candidates, most-preferred first. Renderer fallback per
 * the i18n spec: `navigator.languages` / `navigator.language` (Chromium seeds
 * these from the OS; the Electron main process uses `app.getLocale()`).
 */
export function getSystemLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

/** Available message catalogs, straight from the Paraglide runtime. */
export function getAvailableLocales(): readonly AppLocale[] {
  return locales;
}

/** Resolve a stored language preference to a concrete catalog locale. */
export function resolvePreferenceToLocale(preference: string): AppLocale {
  return resolveLocale(preference, getSystemLocales(), locales, baseLocale) as AppLocale;
}

/**
 * Resolve `preference` and make it the active locale for all `m.*()` calls.
 * Also kicks off loading the matching date-fns locale data in the background
 * so date formatting (`$lib/i18n/format`) follows the language; until it
 * arrives, date-fns falls back to its built-in `en`.
 */
export function applyLanguagePreference(preference: string): void {
  activeLocale = resolvePreferenceToLocale(preference);
  void loadDateFnsLocale(activeLocale);
}

/** The locale currently served to `m.*()` calls. */
export function getActiveLocale(): AppLocale {
  return activeLocale;
}

/**
 * A locale's own name in that locale (endonym), e.g. `de` → "Deutsch".
 * Catalog-driven via `Intl.DisplayNames` so new locales need no name table;
 * falls back to the raw tag for anything Intl cannot name.
 */
export function getLocaleEndonym(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale);
    if (name && name !== locale) {
      return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    }
  } catch {
    // Unknown tag — fall through to the raw tag.
  }
  return locale;
}
