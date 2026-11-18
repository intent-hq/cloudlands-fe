// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  CONNECTION_ID_PATTERN,
  LoginRateLimiter,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  accessKeyMatches,
  checkSession,
  deriveSessionToken,
  generateAccessKey,
  hasValidSession,
  isAllowedHost,
  isLoopbackHost,
  isSameOriginUpgrade,
  pageOrigin,
  parseCookies,
  preferredPageOrigin,
  sessionCookieHeader,
  sessionCookieName,
  sessionCookieValue,
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

  it('sets an HttpOnly Lax cookie lasting 400 days, Secure only for https pages', () => {
    const plain = sessionCookieHeader('k', false);
    expect(plain.startsWith(`${sessionCookieName('k')}=`)).toBe(true);
    expect(plain).toContain('HttpOnly');
    expect(plain).toContain('SameSite=Lax');
    expect(plain).toContain('Path=/');
    expect(plain).toContain('Max-Age=34560000');
    expect(plain).not.toContain('Secure');
    expect(sessionCookieHeader('k', true)).toContain('Secure');
  });

  it('names the cookie per access key so servers on one host never collide', () => {
    expect(sessionCookieName('k1')).toBe(sessionCookieName('k1'));
    expect(sessionCookieName('k1')).not.toBe(sessionCookieName('k2'));
    expect(sessionCookieName('k1')).toMatch(/^[A-Za-z0-9_]+$/);
    expect(sessionCookieName('k1')).not.toBe(SESSION_COOKIE);
  });
});

describe('checkSession', () => {
  const DAY = 24 * 60 * 60;
  const issuedAt = 1_800_000_000;
  const at = (seconds: number) => seconds * 1000;
  const cookieFor = (key: string, time: number) => ({
    cookie: `${sessionCookieName(key)}=${sessionCookieValue(key, time)}`,
  });

  it('accepts a fresh session without renewing it', () => {
    expect(checkSession(cookieFor('k', issuedAt), 'k', at(issuedAt + 60))).toEqual({
      valid: true,
      renew: false,
    });
  });

  it('asks to renew a session issued more than a day ago', () => {
    expect(checkSession(cookieFor('k', issuedAt), 'k', at(issuedAt + DAY))).toEqual({
      valid: true,
      renew: true,
    });
  });

  it('expires a session after 400 idle days', () => {
    const headers = cookieFor('k', issuedAt);
    expect(checkSession(headers, 'k', at(issuedAt + SESSION_MAX_AGE_SECONDS - 1)).valid).toBe(true);
    expect(checkSession(headers, 'k', at(issuedAt + SESSION_MAX_AGE_SECONDS)).valid).toBe(false);
  });

  it('rejects another key, a forged issue time and a far-future issue time', () => {
    expect(checkSession(cookieFor('k', issuedAt), 'other', at(issuedAt)).valid).toBe(false);
    const [, mac] = sessionCookieValue('k', issuedAt).split('.');
    const forged = { cookie: `${sessionCookieName('k')}=${(issuedAt + DAY).toString(36)}.${mac}` };
    expect(checkSession(forged, 'k', at(issuedAt + DAY)).valid).toBe(false);
    expect(checkSession(cookieFor('k', issuedAt + DAY), 'k', at(issuedAt)).valid).toBe(false);
    expect(checkSession({ cookie: `${sessionCookieName('k')}=junk` }, 'k').valid).toBe(false);
  });

  it('accepts the cookie older versions issued and asks to replace it', () => {
    const legacy = { cookie: `${SESSION_COOKIE}=${deriveSessionToken('k')}` };
    expect(checkSession(legacy, 'k')).toEqual({ valid: true, renew: true });
    expect(checkSession(legacy, 'other').valid).toBe(false);
  });
});

describe('preferredPageOrigin', () => {
  it('keeps the latest origin, but never replaces a front-end with loopback', () => {
    expect(preferredPageOrigin(null, 'http://127.0.0.1:47120')).toBe('http://127.0.0.1:47120');
    expect(preferredPageOrigin('http://127.0.0.1:47120', 'https://box.ts.net')).toBe(
      'https://box.ts.net',
    );
    expect(preferredPageOrigin('https://box.ts.net', 'http://localhost:47120')).toBe(
      'https://box.ts.net',
    );
    expect(preferredPageOrigin('https://old.ts.net', 'https://new.ts.net')).toBe(
      'https://new.ts.net',
    );
    expect(preferredPageOrigin('https://box.ts.net', null)).toBe('https://box.ts.net');
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

  it('allows loopback hosts and a front-end host that matches X-Forwarded-Host', () => {
    expect(isAllowedHost({ host: '127.0.0.1:47120' })).toBe(true);
    expect(
      isAllowedHost({
        host: 'box.tailnet.ts.net:8443',
        'x-forwarded-host': 'box.tailnet.ts.net:8443',
      }),
    ).toBe(true);
    expect(isAllowedHost({ host: 'evil.example:47120' })).toBe(false);
    expect(isAllowedHost({ host: 'evil.example', 'x-forwarded-host': 'box.ts.net' })).toBe(false);
    expect(isAllowedHost({ host: 'a/b', 'x-forwarded-host': 'a/b' })).toBe(false);
  });

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

  it('reserves budget before a check and refunds it on success', () => {
    const limiter = new LoginRateLimiter(2, 1000, () => 0);
    const first = limiter.reserve();
    const second = limiter.reserve();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(limiter.reserve()).toBeNull();
    first?.();
    expect(limiter.allow()).toBe(true);
  });
});
