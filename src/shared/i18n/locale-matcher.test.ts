import { describe, expect, it } from 'vitest';
import { matchLocale, resolveLocale, SYSTEM_LANGUAGE_PREFERENCE } from './locale-matcher';

// Simulated future catalog set — the matcher must stay catalog-driven, so the
// spec's negotiation cases are asserted against a multi-locale list, not
// hardcoded locale knowledge.
const CATALOGS = ['en', 'de', 'zh-CN'] as const;
const BASE = 'en';

describe('matchLocale', () => {
  it('returns an exact match, case-insensitively', () => {
    expect(matchLocale(['de'], CATALOGS, BASE)).toBe('de');
    expect(matchLocale(['zh-cn'], CATALOGS, BASE)).toBe('zh-CN');
  });

  it('best-matches a regional variant to its language catalog (de-AT → de)', () => {
    expect(matchLocale(['de-AT'], CATALOGS, BASE)).toBe('de');
    expect(matchLocale(['de-CH'], CATALOGS, BASE)).toBe('de');
    expect(matchLocale(['en-GB'], CATALOGS, BASE)).toBe('en');
  });

  it('maps Simplified Chinese tags to zh-CN (zh, zh-SG, zh-Hans-*)', () => {
    expect(matchLocale(['zh'], CATALOGS, BASE)).toBe('zh-CN');
    expect(matchLocale(['zh-SG'], CATALOGS, BASE)).toBe('zh-CN');
    expect(matchLocale(['zh-Hans'], CATALOGS, BASE)).toBe('zh-CN');
    expect(matchLocale(['zh-Hans-HK'], CATALOGS, BASE)).toBe('zh-CN');
  });

  it('does not match Traditional Chinese to zh-CN (zh-TW/zh-HK → fallback)', () => {
    expect(matchLocale(['zh-TW'], CATALOGS, BASE)).toBe(BASE);
    expect(matchLocale(['zh-HK'], CATALOGS, BASE)).toBe(BASE);
    expect(matchLocale(['zh-Hant'], CATALOGS, BASE)).toBe(BASE);
  });

  it('matches Traditional Chinese once a zh-Hant catalog ships', () => {
    const withHant = [...CATALOGS, 'zh-TW'];
    expect(matchLocale(['zh-HK'], withHant, BASE)).toBe('zh-TW');
    expect(matchLocale(['zh-Hant'], withHant, BASE)).toBe('zh-TW');
  });

  it('walks the requested list in order until a match is found', () => {
    expect(matchLocale(['ja', 'zh-SG', 'de'], CATALOGS, BASE)).toBe('zh-CN');
    expect(matchLocale(['ja', 'ko'], CATALOGS, BASE)).toBe(BASE);
  });

  it('falls back when nothing matches or input is empty/invalid', () => {
    expect(matchLocale(['ja'], CATALOGS, BASE)).toBe(BASE);
    expect(matchLocale([], CATALOGS, BASE)).toBe(BASE);
    expect(matchLocale(['', '  ', 'not a tag!!'], CATALOGS, BASE)).toBe(BASE);
  });

  it('prefers the same-region catalog when several share language + script', () => {
    const multiEnglish = ['en-US', 'en-GB'];
    expect(matchLocale(['en-GB'], multiEnglish, 'en-US')).toBe('en-GB');
    expect(matchLocale(['en-AU'], multiEnglish, 'en-US')).toBe('en-US');
  });
});

describe('resolveLocale', () => {
  it('explicit preference wins over the system locale', () => {
    expect(resolveLocale('de', ['zh-SG'], CATALOGS, BASE)).toBe('de');
  });

  it('"system" best-matches the OS locales against the catalogs', () => {
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['de-AT'], CATALOGS, BASE)).toBe('de');
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['zh-SG'], CATALOGS, BASE)).toBe('zh-CN');
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['zh-TW'], CATALOGS, BASE)).toBe(BASE);
  });

  it('falls back to the base locale when nothing matches', () => {
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['ja-JP'], CATALOGS, BASE)).toBe(BASE);
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, [], CATALOGS, BASE)).toBe(BASE);
  });

  it('an explicit preference without a catalog falls back to system matching', () => {
    expect(resolveLocale('fr', ['de-AT'], CATALOGS, BASE)).toBe('de');
    expect(resolveLocale('fr', ['ja-JP'], CATALOGS, BASE)).toBe(BASE);
  });

  it('treats empty preference as system', () => {
    expect(resolveLocale('', ['de-AT'], CATALOGS, BASE)).toBe('de');
  });
});
