/**
 * Main-process locale service: preference storage, catalog-driven resolution
 * (explicit preference → system best-match → base locale), and change
 * signalling for menu rebuilds. The Electron `app` module is globally mocked
 * by test-setup (no getLocale/getPreferredSystemLanguages), so system-locale
 * candidates default to the empty list here.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { baseLocale, locales } from '../../shared/paraglide/runtime.js';
import { SYSTEM_LANGUAGE_PREFERENCE } from '../../shared/i18n/locale-matcher';
import { m } from '../../shared/paraglide/messages.js';
import {
  getMainActiveLocale,
  getMainLanguagePreference,
  getMainSystemLocales,
  setMainLanguagePreference,
} from '../main-locale';

describe('main-locale', () => {
  beforeEach(() => {
    setMainLanguagePreference(SYSTEM_LANGUAGE_PREFERENCE, []);
  });

  it('defaults to the base locale for the system sentinel with no system locales', () => {
    expect(getMainActiveLocale()).toBe(baseLocale);
    expect(getMainLanguagePreference()).toBe(SYSTEM_LANGUAGE_PREFERENCE);
  });

  it('stores the preference and resolves an explicit catalog locale', () => {
    const changed = setMainLanguagePreference('en', []);
    expect(getMainLanguagePreference()).toBe('en');
    expect(getMainActiveLocale()).toBe('en');
    // en is already active, so no change is signalled.
    expect(changed).toBe(false);
  });

  it('falls back to the base locale for a preference without a catalog', () => {
    setMainLanguagePreference('xx-XX', []);
    expect(getMainActiveLocale()).toBe(baseLocale);
  });

  it('best-matches system locales against the available catalogs', () => {
    setMainLanguagePreference(SYSTEM_LANGUAGE_PREFERENCE, ['en-GB', 'de-AT']);
    expect(getMainActiveLocale()).toBe('en');
  });

  it('always resolves to a catalog locale', () => {
    for (const preference of ['en', 'de', 'zz', SYSTEM_LANGUAGE_PREFERENCE]) {
      setMainLanguagePreference(preference, ['fr-FR']);
      expect(locales).toContain(getMainActiveLocale());
    }
  });

  it('routes main-process m.*() calls through the active locale without throwing', () => {
    setMainLanguagePreference('en', []);
    expect(m.quit_dialog_quit_button()).toBe('Quit');
  });

  it('returns an empty system-locale list under the mocked electron app', () => {
    expect(getMainSystemLocales()).toEqual([]);
  });
});
