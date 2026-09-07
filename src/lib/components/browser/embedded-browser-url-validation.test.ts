import { describe, expect, it } from 'vitest';
import { isValidBrowserUrl, normalizeBrowserAddressInput } from './embedded-browser-url-validation';

describe('embedded browser URL validation', () => {
  const appOrigin = 'https://app.intent.test';

  it('allows exactly about:blank', () => {
    expect(isValidBrowserUrl('about:blank', appOrigin)).toBe(true);
    expect(isValidBrowserUrl('about:config', appOrigin)).toBe(false);
    expect(isValidBrowserUrl('about:srcdoc', appOrigin)).toBe(false);
  });

  it.each(['http://example.test', 'https://example.test', 'file:///tmp/example.html'])(
    'preserves support for %s',
    (url) => expect(isValidBrowserUrl(url, appOrigin)).toBe(true),
  );

  it('continues to reject the app origin and invalid URLs', () => {
    expect(isValidBrowserUrl(`${appOrigin}/workspace`, appOrigin)).toBe(false);
    expect(isValidBrowserUrl('not a url', appOrigin)).toBe(false);
  });
});

describe('browser address bar input normalization', () => {
  it.each([
    ['example.test/docs', 'https://example.test/docs'],
    ['localhost:5173', 'http://localhost:5173'],
    ['127.0.0.1:8080/x', 'http://127.0.0.1:8080/x'],
    ['  https://example.test  ', 'https://example.test'],
    ['file:///tmp/example.html', 'file:///tmp/example.html'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeBrowserAddressInput(input)).toBe(expected);
  });

  it('yields null for empty or unparsable input', () => {
    expect(normalizeBrowserAddressInput('   ')).toBeNull();
    expect(normalizeBrowserAddressInput('http://')).toBeNull();
  });
});
