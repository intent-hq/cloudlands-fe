import { describe, expect, it, vi } from 'vitest';
import {
  bundlePathForUrl,
  contentTypeFor,
  createAppSchemeHandler,
  INTENT_APP_CSP,
  intentAppEntryUrl,
} from './app-scheme';

const target = { appId: 'pomodoro-timer', bundleHash: 'sha256:abc', entry: 'index.html' };

describe('intent-app:// scheme', () => {
  it('maps URLs of the app to bundle paths, and the root to the entry', () => {
    expect(bundlePathForUrl('intent-app://pomodoro-timer/', target)).toBe('index.html');
    expect(bundlePathForUrl('intent-app://pomodoro-timer/assets/app.js?v=1', target)).toBe(
      'assets/app.js',
    );
    expect(bundlePathForUrl('intent-app://pomodoro-timer/a%20b.css', target)).toBe('a b.css');
  });

  it('refuses another app, traversal and encoded separators', () => {
    expect(bundlePathForUrl('intent-app://other-app/index.html', target)).toBeNull();
    // The URL parser resolves dot segments first, so `..` can never leave the bundle root.
    expect(bundlePathForUrl('intent-app://pomodoro-timer/a/%2e%2e/b', target)).toBe('b');
    expect(bundlePathForUrl('intent-app://pomodoro-timer/../../etc/passwd', target)).toBe(
      'etc/passwd',
    );
    expect(bundlePathForUrl('intent-app://pomodoro-timer/a%2Fb', target)).toBeNull();
    expect(bundlePathForUrl('intent-app://pomodoro-timer/a%5Cb', target)).toBeNull();
    expect(bundlePathForUrl('intent-app://pomodoro-timer/a%00b', target)).toBeNull();
    expect(bundlePathForUrl('intent-app://pomodoro-timer/a//b', target)).toBeNull();
    expect(bundlePathForUrl('https://pomodoro-timer/index.html', target)).toBeNull();
  });

  it('builds the entry URL', () => {
    expect(intentAppEntryUrl('notes', 'web/index.html')).toBe('intent-app://notes/web/index.html');
  });

  it('adds a UTF-8 charset to text types only', () => {
    expect(contentTypeFor('text/html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('image/png')).toBe('image/png');
  });

  it('serves a file through app.readBundle pinned to the session hash, with the CSP', async () => {
    const readBundle = vi.fn(async () => ({
      mimeType: 'text/html',
      contentBase64: Buffer.from('<h1>Hi</h1>').toString('base64'),
    }));
    const handler = createAppSchemeHandler(() => target, readBundle);
    const response = await handler(new Request('intent-app://pomodoro-timer/'));
    expect(readBundle).toHaveBeenCalledWith({
      appId: 'pomodoro-timer',
      path: 'index.html',
      bundleHash: 'sha256:abc',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toBe(INTENT_APP_CSP);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<h1>Hi</h1>');
  });

  it('answers 404 for a file outside the bundle and 410 once the app is closed', async () => {
    const readBundle = vi.fn(async () => {
      throw Object.assign(new Error('not found'), { data: { code: 'file-not-found' } });
    });
    const handler = createAppSchemeHandler(() => target, readBundle);
    expect((await handler(new Request('intent-app://pomodoro-timer/missing.js'))).status).toBe(404);
    expect((await handler(new Request('intent-app://other-app/index.html'))).status).toBe(404);
    const closed = createAppSchemeHandler(() => null, readBundle);
    expect((await closed(new Request('intent-app://pomodoro-timer/'))).status).toBe(410);
  });

  it('keeps the CSP verbatim from the contract (no network for the app)', () => {
    expect(INTENT_APP_CSP).toContain("connect-src 'none'");
    expect(INTENT_APP_CSP).toContain("default-src 'self'");
    expect(INTENT_APP_CSP).toContain("frame-src 'none'");
  });
});
