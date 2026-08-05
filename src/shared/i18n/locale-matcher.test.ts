import { describe, expect, it } from 'vitest';
import { matchLocale, resolveLocale, SYSTEM_LANGUAGE_PREFERENCE } from './locale-matcher';

// Simulated catalog set — the matcher must stay catalog-driven, so the
// spec's negotiation cases are asserted against a multi-locale list, not
// hardcoded locale knowledge.
const CATALOGS = ['en', 'de', 'zh-CN', 'zh-TW'] as const;
// Catalog set including the CJK single-catalog locales (ja, ko) — regional
// variants must best-match onto the bare language catalog.
const WITH_JA_KO = ['en', 'de', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const;
// Catalog set without a zh-Hant entry — Traditional tags must skip to the
// fallback rather than mismatch onto the Simplified catalog.
const SIMPLIFIED_ONLY = ['en', 'de', 'zh-CN'] as const;
// Catalog set with the European single-catalog locales (de, fr, es) —
// regional variants must best-match onto the bare language catalog.
const WITH_EURO = ['en', 'de', 'fr', 'es', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const;
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
    expect(matchLocale(['zh-Hans-SG'], CATALOGS, BASE)).toBe('zh-CN');
    expect(matchLocale(['zh-Hans-CN'], CATALOGS, BASE)).toBe('zh-CN');
  });

  it('maps Traditional Chinese tags to zh-TW (zh-TW, zh-HK, zh-MO, zh-Hant-*)', () => {
    expect(matchLocale(['zh-TW'], CATALOGS, BASE)).toBe('zh-TW');
    expect(matchLocale(['zh-HK'], CATALOGS, BASE)).toBe('zh-TW');
    expect(matchLocale(['zh-MO'], CATALOGS, BASE)).toBe('zh-TW');
    expect(matchLocale(['zh-Hant'], CATALOGS, BASE)).toBe('zh-TW');
    expect(matchLocale(['zh-Hant-TW'], CATALOGS, BASE)).toBe('zh-TW');
    expect(matchLocale(['zh-Hant-HK'], CATALOGS, BASE)).toBe('zh-TW');
    expect(matchLocale(['zh-Hant-MO'], CATALOGS, BASE)).toBe('zh-TW');
  });

  it('does not match Traditional Chinese to zh-CN when no zh-Hant catalog ships', () => {
    expect(matchLocale(['zh-TW'], SIMPLIFIED_ONLY, BASE)).toBe(BASE);
    expect(matchLocale(['zh-HK'], SIMPLIFIED_ONLY, BASE)).toBe(BASE);
    expect(matchLocale(['zh-Hant'], SIMPLIFIED_ONLY, BASE)).toBe(BASE);
    expect(matchLocale(['zh-Hant-MO'], SIMPLIFIED_ONLY, BASE)).toBe(BASE);
  });

  it('does not match Simplified Chinese to zh-TW when only zh-TW ships', () => {
    const traditionalOnly = ['en', 'zh-TW'];
    expect(matchLocale(['zh'], traditionalOnly, BASE)).toBe(BASE);
    expect(matchLocale(['zh-Hans-CN'], traditionalOnly, BASE)).toBe(BASE);
  });

  it('maps Japanese tags to ja (ja, ja-JP, ja-Jpan-JP)', () => {
    expect(matchLocale(['ja'], WITH_JA_KO, BASE)).toBe('ja');
    expect(matchLocale(['ja-JP'], WITH_JA_KO, BASE)).toBe('ja');
    expect(matchLocale(['ja-Jpan-JP'], WITH_JA_KO, BASE)).toBe('ja');
  });

  it('maps Korean tags to ko (ko, ko-KR, ko-KP, ko-Kore-KR)', () => {
    expect(matchLocale(['ko'], WITH_JA_KO, BASE)).toBe('ko');
    expect(matchLocale(['ko-KR'], WITH_JA_KO, BASE)).toBe('ko');
    expect(matchLocale(['ko-KP'], WITH_JA_KO, BASE)).toBe('ko');
    expect(matchLocale(['ko-Kore-KR'], WITH_JA_KO, BASE)).toBe('ko');
  });

  it('maps German regional tags to de (de, de-DE, de-AT, de-CH, de-Latn-DE)', () => {
    expect(matchLocale(['de'], WITH_EURO, BASE)).toBe('de');
    expect(matchLocale(['de-DE'], WITH_EURO, BASE)).toBe('de');
    expect(matchLocale(['de-AT'], WITH_EURO, BASE)).toBe('de');
    expect(matchLocale(['de-CH'], WITH_EURO, BASE)).toBe('de');
    expect(matchLocale(['de-Latn-DE'], WITH_EURO, BASE)).toBe('de');
  });

  it('maps French regional tags to fr (fr, fr-FR, fr-CA, fr-CH, fr-BE)', () => {
    expect(matchLocale(['fr'], WITH_EURO, BASE)).toBe('fr');
    expect(matchLocale(['fr-FR'], WITH_EURO, BASE)).toBe('fr');
    expect(matchLocale(['fr-CA'], WITH_EURO, BASE)).toBe('fr');
    expect(matchLocale(['fr-CH'], WITH_EURO, BASE)).toBe('fr');
    expect(matchLocale(['fr-BE'], WITH_EURO, BASE)).toBe('fr');
  });

  it('maps Spanish regional tags to es (es, es-ES, es-MX, es-AR, es-US)', () => {
    expect(matchLocale(['es'], WITH_EURO, BASE)).toBe('es');
    expect(matchLocale(['es-ES'], WITH_EURO, BASE)).toBe('es');
    expect(matchLocale(['es-MX'], WITH_EURO, BASE)).toBe('es');
    expect(matchLocale(['es-AR'], WITH_EURO, BASE)).toBe('es');
    expect(matchLocale(['es-US'], WITH_EURO, BASE)).toBe('es');
  });

  it('walks the requested list in order until a match is found', () => {
    expect(matchLocale(['ja', 'zh-SG', 'de'], CATALOGS, BASE)).toBe('zh-CN');
    expect(matchLocale(['ja', 'ko'], CATALOGS, BASE)).toBe(BASE);
    expect(matchLocale(['fr', 'ko-KR'], WITH_JA_KO, BASE)).toBe('ko');
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
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['zh-HK'], CATALOGS, BASE)).toBe('zh-TW');
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['zh-TW'], SIMPLIFIED_ONLY, BASE)).toBe(
      BASE,
    );
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['ja-JP'], WITH_JA_KO, BASE)).toBe('ja');
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['ko-KR'], WITH_JA_KO, BASE)).toBe('ko');
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['fr-CA'], WITH_EURO, BASE)).toBe('fr');
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['es-MX'], WITH_EURO, BASE)).toBe('es');
    expect(resolveLocale(SYSTEM_LANGUAGE_PREFERENCE, ['de-CH'], WITH_EURO, BASE)).toBe('de');
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
