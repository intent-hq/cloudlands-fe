/**
 * Main-process locale service — owns the active Paraglide locale for every
 * `m.*()` call made in the Electron main process (application menu, native
 * dialogs, desktop notifications).
 *
 * Mirrors the renderer's `$lib/i18n/locale` service: resolution is
 * catalog-driven via `../shared/i18n/locale-matcher` (explicit preference →
 * system locale best-match → base locale). The explicit preference is synced
 * from the renderer over the `app:set-language-preference` IPC channel (the
 * renderer owns persistence in localStorage); until the first sync arrives the
 * main process best-matches the OS locale from `app.getPreferredSystemLanguages()`
 * / `app.getLocale()`.
 */

import { app } from 'electron';

import { baseLocale, locales, overwriteGetLocale } from '../shared/paraglide/runtime.js';
import { resolveLocale, SYSTEM_LANGUAGE_PREFERENCE } from '../shared/i18n/locale-matcher';

export type MainLocale = (typeof locales)[number];

let languagePreference: string = SYSTEM_LANGUAGE_PREFERENCE;
let activeLocale: MainLocale = baseLocale;

// Route every main-process m.*() call through the service-owned active locale.
overwriteGetLocale(() => activeLocale);

/**
 * OS/system locale candidates, most-preferred first. Main-process counterpart
 * of the renderer's `navigator.languages` fallback: the full preferred-language
 * list when available, otherwise the single `app.getLocale()` value.
 */
export function getMainSystemLocales(): readonly string[] {
  try {
    if (typeof app.getPreferredSystemLanguages === 'function') {
      const preferred = app.getPreferredSystemLanguages();
      if (Array.isArray(preferred) && preferred.length > 0) return preferred;
    }
    if (typeof app.getLocale === 'function') {
      const locale = app.getLocale();
      if (locale) return [locale];
    }
  } catch {
    // Fall through to the empty list — resolution then uses the base locale.
  }
  return [];
}

/**
 * Store `preference` and resolve it to the active main-process locale.
 * Returns true when the resolved locale changed (callers use this to rebuild
 * the application menu without a restart).
 */
export function setMainLanguagePreference(
  preference: string,
  systemLocales: readonly string[] = getMainSystemLocales(),
): boolean {
  languagePreference = preference;
  const next = resolveLocale(preference, systemLocales, locales, baseLocale) as MainLocale;
  const changed = next !== activeLocale;
  activeLocale = next;
  return changed;
}

/** The locale currently served to main-process `m.*()` calls. */
export function getMainActiveLocale(): MainLocale {
  return activeLocale;
}

/** The last language preference synced from the renderer (or the sentinel). */
export function getMainLanguagePreference(): string {
  return languagePreference;
}
