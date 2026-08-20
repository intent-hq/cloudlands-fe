/**
 * Error Message Localization
 *
 * Manages localization of error messages across different languages
 */

import {
  getLocalizedMessage,
  formatErrorMessage,
  ERROR_MESSAGE_TEMPLATES,
  type SupportedLocale,
} from './messages';

// Re-export SupportedLocale for convenience
export type { SupportedLocale };

export interface ErrorTranslation {
  code: string;
  locale: SupportedLocale;
  message: string;
  helpLink?: string;
}

/**
 * Current locale setting
 */
let currentLocale: SupportedLocale = 'en';

/**
 * Set the current locale for error messages
 */
export function setLocale(locale: SupportedLocale): void {
  currentLocale = locale;
}

/**
 * Get the current locale
 */
export function getLocale(): SupportedLocale {
  return currentLocale;
}

/**
 * Translate an error code to the current locale
 */
export function translateError(code: string, context?: Record<string, any>): ErrorTranslation {
  // Use template if available and context provided, otherwise use localized message
  let message: string;

  if (context && ERROR_MESSAGE_TEMPLATES[code]) {
    message = formatErrorMessage(ERROR_MESSAGE_TEMPLATES[code], context);
  } else {
    message = getLocalizedMessage(code, currentLocale);
  }

  return {
    code,
    locale: currentLocale,
    message,
  };
}

/**
 * Supported locales with their display names
 */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  zh: '中文',
};

/**
 * Get all supported locales
 */
export function getSupportedLocales(): SupportedLocale[] {
  return Object.keys(LOCALE_DISPLAY_NAMES) as SupportedLocale[];
}

/**
 * Detect locale from browser or system
 */
function detectLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') {
    return 'en';
  }

  const browserLocale = navigator.language.split('-')[0];
  const supportedLocales = getSupportedLocales();

  if (supportedLocales.includes(browserLocale as SupportedLocale)) {
    return browserLocale as SupportedLocale;
  }

  return 'en';
}

/**
 * Initialize localization with detected or specified locale
 */
export function initializeLocalization(locale?: SupportedLocale): void {
  const localeToUse = locale || detectLocale();
  setLocale(localeToUse);
}
