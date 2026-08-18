import { describe, expect, it } from 'vitest';
import { isValidBrowserUrl } from './embedded-browser-url-validation';

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
