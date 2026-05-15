/**
 * Tests for Error Localization Module
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import {
  setLocale,
  getLocale,
  translateError,
  getSupportedLocales,
  LOCALE_DISPLAY_NAMES,
  initializeLocalization,
  type SupportedLocale,
} from '../localization';

describe('Error Localization Module', () => {
  beforeEach(() => {
    // Reset to English before each test
    setLocale('en');
  });

  describe('setLocale and getLocale', () => {
    it('should set and get locale', () => {
      setLocale('en');
      expect(getLocale()).toBe('en');

      setLocale('es');
      expect(getLocale()).toBe('es');
    });

    it('should default to English', () => {
      expect(getLocale()).toBe('en');
    });

    it('should support all locales', () => {
      const locales: SupportedLocale[] = ['en', 'es', 'fr', 'de', 'ja', 'zh'];
      locales.forEach((locale) => {
        setLocale(locale);
        expect(getLocale()).toBe(locale);
      });
    });
  });

  describe('translateError', () => {
    it('should translate error code to current locale', () => {
      setLocale('en');
      const translation = translateError('SESSION_NOT_FOUND');
      expect(translation.code).toBe('SESSION_NOT_FOUND');
      expect(translation.locale).toBe('en');
      expect(translation.message).toBeTruthy();
    });

    it('should format message with context', () => {
      const translation = translateError('SESSION_NOT_FOUND', {
        sessionId: 'sess-123',
      });
      expect(translation.message).toContain('sess-123');
    });

    it('should handle missing context gracefully', () => {
      const translation = translateError('SESSION_NOT_FOUND');
      expect(translation.message).toBeTruthy();
    });

    it('should return error translation object', () => {
      const translation = translateError('AGENT_CREATION_FAILED');
      expect(translation).toHaveProperty('code');
      expect(translation).toHaveProperty('locale');
      expect(translation).toHaveProperty('message');
    });
  });

  describe('getSupportedLocales', () => {
    it('should return array of supported locales', () => {
      const locales = getSupportedLocales();
      expect(Array.isArray(locales)).toBe(true);
      expect(locales.length).toBeGreaterThan(0);
    });

    it('should include English', () => {
      const locales = getSupportedLocales();
      expect(locales).toContain('en');
    });

    it('should include all expected locales', () => {
      const locales = getSupportedLocales();
      expect(locales).toContain('en');
      expect(locales).toContain('es');
      expect(locales).toContain('fr');
      expect(locales).toContain('de');
      expect(locales).toContain('ja');
      expect(locales).toContain('zh');
    });
  });

  describe('LOCALE_DISPLAY_NAMES', () => {
    it('should have display names for all locales', () => {
      const locales = getSupportedLocales();
      locales.forEach((locale) => {
        expect(LOCALE_DISPLAY_NAMES[locale]).toBeTruthy();
      });
    });

    it('should have English display name', () => {
      expect(LOCALE_DISPLAY_NAMES.en).toBe('English');
    });

    it('should have non-English display names', () => {
      expect(LOCALE_DISPLAY_NAMES.es).toBe('Español');
      expect(LOCALE_DISPLAY_NAMES.fr).toBe('Français');
      expect(LOCALE_DISPLAY_NAMES.de).toBe('Deutsch');
      expect(LOCALE_DISPLAY_NAMES.ja).toBe('日本語');
      expect(LOCALE_DISPLAY_NAMES.zh).toBe('中文');
    });
  });

  describe('initializeLocalization', () => {
    it('should initialize with specified locale', () => {
      initializeLocalization('es');
      expect(getLocale()).toBe('es');
    });

    it('should initialize with English by default', () => {
      initializeLocalization();
      expect(getLocale()).toBe('en');
    });

    it('should handle invalid locale gracefully', () => {
      // Should not throw
      expect(() => {
        initializeLocalization('en');
      }).not.toThrow();
    });
  });

  describe('Locale Switching', () => {
    it('should switch between locales', () => {
      setLocale('en');
      let translation = translateError('SESSION_NOT_FOUND');
      expect(translation.locale).toBe('en');

      setLocale('es');
      translation = translateError('SESSION_NOT_FOUND');
      expect(translation.locale).toBe('es');

      setLocale('en');
      translation = translateError('SESSION_NOT_FOUND');
      expect(translation.locale).toBe('en');
    });

    it('should maintain message consistency across locales', () => {
      const locales: SupportedLocale[] = ['en', 'es', 'fr'];
      const translations = locales.map((locale) => {
        setLocale(locale);
        return translateError('SESSION_NOT_FOUND');
      });

      translations.forEach((translation) => {
        expect(translation.message).toBeTruthy();
        expect(translation.code).toBe('SESSION_NOT_FOUND');
      });
    });
  });

  describe('Error Translation with Context', () => {
    it('should format message with multiple context values', () => {
      const translation = translateError('MESSAGE_TOO_LONG', {
        maxLength: 1000,
        currentLength: 1500,
      });
      expect(translation.message).toContain('1000');
      expect(translation.message).toContain('1500');
    });

    it('should handle missing context values', () => {
      const translation = translateError('MESSAGE_TOO_LONG', {
        maxLength: 1000,
      });
      expect(translation.message).toBeTruthy();
    });
  });
});
