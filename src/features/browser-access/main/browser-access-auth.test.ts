// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  CONNECTION_ID_PATTERN,
  LoginRateLimiter,
  SESSION_COOKIE,
  accessKeyMatches,
  deriveSessionToken,
  generateAccessKey,
  hasValidSession,
  isLoopbackHost,
  isSameOriginUpgrade,
  pageOrigin,
  parseCookies,
  sessionCookieHeader,
} from './browser-access-auth';

describe('access keys and sessions', () => {
  it('generates distinct URL-safe 256-bit keys', () => {
    const a = generateAccessKey();
    const b = generateAccessKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('derives a stable session token that changes with the key', () => {
    expect(deriveSessionToken('key-one')).toBe(deriveSessionToken('key-one'));
    expect(deriveSessionToken('key-one')).not.toBe(deriveSessionToken('key-two'));
    expect(deriveSessionToken('key-one')).not.toContain('key-one');
  });

  it('matches only the exact key (ignoring surrounding spaces)', () => {
    expect(accessKeyMatches('secret', 'secret')).toBe(true);
    expect(accessKeyMatches('  secret\n', 'secret')).toBe(true);
    expect(accessKeyMatches('secre', 'secret')).toBe(false);
    expect(accessKeyMatches('secretx', 'secret')).toBe(false);
    expect(accessKeyMatches('', 'secret')).toBe(false);
    expect(accessKeyMatches(undefined, 'secret')).toBe(false);
  });

  it('accepts only the cookie derived from the current key', () => {
    const cookie = `other=1; ${SESSION_COOKIE}=${deriveSessionToken('k1')}`;
    expect(hasValidSession({ cookie }, 'k1')).toBe(true);
    expect(hasValidSession({ cookie }, 'k2')).toBe(false);
    expect(hasValidSession({}, 'k1')).toBe(false);
    expect(hasValidSession({ cookie: `${SESSION_COOKIE}=k1` }, 'k1')).toBe(false);
  });

  it('parses cookies, keeping the first occurrence', () => {
    const cookies = parseCookies('a=1; b = two ; a=3; junk; =x');
    expect(cookies.get('a')).toBe('1');
    expect(cookies.get('b')).toBe('two');
    expect(cookies.size).toBe(2);
  });

  it('sets an HttpOnly Lax cookie and adds Secure only for https pages', () => {
    const plain = sessionCookieHeader('k', false);
    expect(plain).toContain(`${SESSION_COOKIE}=${deriveSessionToken('k')}`);
    expect(plain).toContain('HttpOnly');
    expect(plain).toContain('SameSite=Lax');
    expect(plain).not.toContain('Secure');
    expect(sessionCookieHeader('k', true)).toContain('Secure');
  });
});

describe('request checks', () => {
  it.each(['127.0.0.1:47120', 'localhost:47120', 'localhost', '[::1]:9', 'app.localhost:1'])(
    'treats %s as loopback',
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );

  it.each([
    'box.tailnet.ts.net',
    'evil.example:47120',
    '10.0.0.5:47120',
    'a@127.0.0.1',
    '127.0.0.1/x',
    undefined,
  ])('rejects %s as non-loopback', (host) => expect(isLoopbackHost(host)).toBe(false));

  it('uses the forwarded page origin from a front-end', () => {
    expect(
      pageOrigin({
        host: '127.0.0.1:47120',
        'x-forwarded-host': 'box.tailnet.ts.net',
        'x-forwarded-proto': 'https',
      }),
    ).toBe('https://box.tailnet.ts.net');
    expect(
      pageOrigin({
        'x-forwarded-host': 'box.ts.net:443, inner',
        'x-forwarded-proto': 'https, http',
      }),
    ).toBe('https://box.ts.net');
    expect(pageOrigin({ host: '127.0.0.1:47120' })).toBe('http://127.0.0.1:47120');
    expect(pageOrigin({ host: 'a/b' })).toBeNull();
    expect(pageOrigin({})).toBeNull();
  });

  it('accepts only same-origin WebSocket upgrades', () => {
    const proxied = {
      host: '127.0.0.1:47120',
      'x-forwarded-host': 'box.ts.net',
      'x-forwarded-proto': 'https',
    };
    expect(isSameOriginUpgrade({ ...proxied, origin: 'https://box.ts.net' })).toBe(true);
    expect(isSameOriginUpgrade({ ...proxied, origin: 'https://evil.example' })).toBe(false);
    expect(isSameOriginUpgrade({ ...proxied, origin: 'http://box.ts.net' })).toBe(false);
    expect(isSameOriginUpgrade(proxied)).toBe(false);
    expect(isSameOriginUpgrade({ host: '127.0.0.1:47120', origin: 'http://127.0.0.1:47120' })).toBe(
      true,
    );
  });

  it('accepts connection ids and rejects path-like input', () => {
    expect(CONNECTION_ID_PATTERN.test('local')).toBe(true);
    expect(CONNECTION_ID_PATTERN.test('3f2a9c1e-1d2b-4c3d-9e8f-0a1b2c3d4e5f')).toBe(true);
    expect(CONNECTION_ID_PATTERN.test('../etc')).toBe(false);
    expect(CONNECTION_ID_PATTERN.test('a/b')).toBe(false);
    expect(CONNECTION_ID_PATTERN.test('')).toBe(false);
  });
});

describe('LoginRateLimiter', () => {
  it('blocks after the failure budget and recovers when the window passes', () => {
    let now = 0;
    const limiter = new LoginRateLimiter(3, 1000, () => now);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(limiter.allow()).toBe(true);
      limiter.recordFailure();
    }
    expect(limiter.allow()).toBe(false);
    now = 1001;
    expect(limiter.allow()).toBe(true);
  });
});
