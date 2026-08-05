import { describe, expect, it } from 'vitest';
import { getLocaleEndonym } from './locale';

describe('getLocaleEndonym', () => {
  it('names Simplified Chinese catalogs by script, not region', () => {
    expect(getLocaleEndonym('zh-CN')).toBe('简体中文');
    expect(getLocaleEndonym('zh-Hans')).toBe('简体中文');
  });

  it('maximizes bare zh to the Simplified script name', () => {
    expect(getLocaleEndonym('zh')).toBe('简体中文');
  });

  it('names Traditional Chinese tags by script', () => {
    expect(getLocaleEndonym('zh-TW')).toBe('繁體中文');
    expect(getLocaleEndonym('zh-HK')).toBe('繁體中文');
    expect(getLocaleEndonym('zh-Hant')).toBe('繁體中文');
  });

  it('leaves non-Chinese locales on the plain Intl.DisplayNames path', () => {
    expect(getLocaleEndonym('en')).toBe('English');
    expect(getLocaleEndonym('de')).toBe('Deutsch');
  });

  it('names the CJK single-catalog locales by their endonyms', () => {
    expect(getLocaleEndonym('ja')).toBe('日本語');
    expect(getLocaleEndonym('ko')).toBe('한국어');
  });

  it('capitalizes endonyms that Intl returns lowercase', () => {
    expect(getLocaleEndonym('fr')).toBe('Français');
  });

  it('falls back to the raw tag for structurally invalid input', () => {
    expect(getLocaleEndonym('not a locale')).toBe('not a locale');
  });
});
