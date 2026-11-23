import { describe, expect, it } from 'vitest';
import { browserPanelUserAgent, withChromeBrandHeaders } from './browser-panel-user-agent';

const ELECTRON_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) intent-cloudlands/2.381.1 Chrome/142.0.7444.59 Electron/44.0.0 Safari/537.36';
const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36';

describe('browserPanelUserAgent', () => {
  it('drops the Electron and app tokens and keeps Chrome', () => {
    expect(browserPanelUserAgent(ELECTRON_UA, 'intent-cloudlands')).toBe(CHROME_UA);
  });

  it('matches the app name literally, whatever its case or punctuation', () => {
    const ua = CHROME_UA.replace('Chrome/', 'Intent.App/1.0 Chrome/');
    expect(browserPanelUserAgent(ua, 'intent.app')).toBe(CHROME_UA);
  });

  it('leaves a plain Chrome user agent unchanged', () => {
    expect(browserPanelUserAgent(CHROME_UA, 'intent-cloudlands')).toBe(CHROME_UA);
  });
});

const brands = (list: string) => withChromeBrandHeaders({ 'sec-ch-ua': list })['sec-ch-ua'];

describe('withChromeBrandHeaders', () => {
  it('adds Google Chrome at the Chromium version', () => {
    expect(brands('"Chromium";v="142", "Not_A Brand";v="99"')).toBe(
      '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    );
    expect(brands('"Not_A Brand";v="99.0.0.0", "Chromium";v="142.0.7444.59"')).toBe(
      '"Not_A Brand";v="99.0.0.0", "Chromium";v="142.0.7444.59", "Google Chrome";v="142.0.7444.59"',
    );
  });

  it('leaves a list that already names Google Chrome, or lacks Chromium, unchanged', () => {
    const chrome = '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"';
    expect(brands(chrome)).toBe(chrome);
    expect(brands('"Not_A Brand";v="99"')).toBe('"Not_A Brand";v="99"');
  });

  it('rewrites only the brand-list headers, whatever their case', () => {
    const headers = withChromeBrandHeaders({
      'Sec-CH-UA': '"Chromium";v="142"',
      'sec-ch-ua-full-version-list': '"Chromium";v="142.0.7444.59"',
      'Sec-CH-UA-Platform': '"Linux"',
    });
    expect(headers).toEqual({
      'Sec-CH-UA': '"Chromium";v="142", "Google Chrome";v="142"',
      'sec-ch-ua-full-version-list':
        '"Chromium";v="142.0.7444.59", "Google Chrome";v="142.0.7444.59"',
      'Sec-CH-UA-Platform': '"Linux"',
    });
  });
});
