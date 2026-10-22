/**
 * Update-check telemetry helpers: the updates.intentapp.dev feed URL, the
 * install-source and daily-flag derivations, feed selection (telemetry vs
 * GitHub vs a custom AUTO_UPDATE_URL), and the updater-session host
 * allowlist.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildTelemetryFeedUrl,
  detectInstallSource,
  installUpdateRequestAllowlist,
  isAllowedUpdateUrl,
  isDoNotTrack,
  isFirstCheckOfUtcDay,
  resolveUpdateFeed,
  utcDay,
} from './update-telemetry';

const TELEMETRY_BASE = 'https://updates.intentapp.dev/desktop';
const GITHUB_BASE = 'https://github.com/intent-hq/cloudlands-releases/releases/download';

describe('detectInstallSource', () => {
  it.each([
    ['darwin', {}, 'dmg'],
    ['win32', {}, 'nsis'],
    ['linux', { APPIMAGE: '/home/u/Intent.AppImage' }, 'appimage'],
    ['linux', {}, 'deb'],
    ['linux', { APPIMAGE: '' }, 'deb'],
    ['freebsd', {}, 'unknown'],
  ] as const)('%s with env %j → %s', (platform, env, expected) => {
    expect(detectInstallSource(platform, env)).toBe(expected);
  });
});

describe('buildTelemetryFeedUrl', () => {
  it.each([
    ['darwin', 'arm64', 'dmg', 'manual', true],
    ['win32', 'x64', 'nsis', 'startup', false],
    ['linux', 'x64', 'appimage', 'periodic', false],
    ['linux', 'arm64', 'deb', 'focus', true],
    ['darwin', 'x64', 'unknown', 'channel', false],
  ] as const)('%s-%s src=%s k=%s d=%s', (platform, arch, source, trigger, daily) => {
    const url = new URL(
      buildTelemetryFeedUrl(TELEMETRY_BASE, 'stable', {
        platform,
        arch,
        version: '2.219.8',
        source,
        trigger,
        daily,
        weekly: daily,
        monthly: false,
        install: false,
        age: '31-90d',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://updates.intentapp.dev/desktop/stable');
    expect([...url.searchParams.entries()]).toEqual([
      ['p', `${platform}-${arch}`],
      ['v', '2.219.8'],
      ['src', source],
      ['k', trigger],
      ['d', daily ? '1' : '0'],
      ['w', daily ? '1' : '0'],
      ['m', '0'],
      ['i', '0'],
      ['a', '31-90d'],
    ]);
  });

  it('keeps the channel in the path and the query on the feed electron-updater resolves files against', () => {
    const feed = buildTelemetryFeedUrl(TELEMETRY_BASE, 'beta', {
      platform: 'darwin',
      arch: 'arm64',
      version: '3.0.0-beta.1',
      source: 'dmg',
      trigger: 'manual',
      daily: false,
      weekly: false,
      monthly: false,
      install: false,
      age: 'unknown',
    });
    // electron-updater 6.x (util.newUrlFromBase) copies the base URL's search
    // onto every file it resolves relative to the feed.
    const base = new URL(feed);
    base.pathname += '/';
    const channelFile = new URL('latest-mac.yml', base);
    channelFile.search = base.search;
    expect(channelFile.href).toBe(
      'https://updates.intentapp.dev/desktop/beta/latest-mac.yml?p=darwin-arm64&v=3.0.0-beta.1&src=dmg&k=manual&d=0&w=0&m=0&i=0&a=unknown',
    );
  });
});

describe('daily flag', () => {
  it('formats the UTC calendar day, not the local one', () => {
    expect(utcDay(new Date('2026-10-21T23:59:59.999Z'))).toBe('2026-10-21');
    expect(utcDay(new Date('2026-10-22T00:00:00.000Z'))).toBe('2026-10-22');
  });

  it('is set for the first check of a UTC day and cleared for later checks that day', () => {
    expect(isFirstCheckOfUtcDay(undefined, new Date('2026-10-21T10:00:00Z'))).toBe(true);
    expect(isFirstCheckOfUtcDay('2026-10-21', new Date('2026-10-21T23:59:59Z'))).toBe(false);
  });

  it('is set again once the UTC day rolls over', () => {
    expect(isFirstCheckOfUtcDay('2026-10-21', new Date('2026-10-22T00:00:01Z'))).toBe(true);
  });

  it('treats a malformed stored value as no previous check', () => {
    expect(isFirstCheckOfUtcDay(42, new Date('2026-10-21T10:00:00Z'))).toBe(true);
  });
});

describe('isDoNotTrack', () => {
  it.each([
    [{ DO_NOT_TRACK: '1' }, true],
    [{ DO_NOT_TRACK: 'true' }, true],
    [{ DO_NOT_TRACK: '0' }, false],
    [{}, false],
  ])('%j → %s', (env, expected) => {
    expect(isDoNotTrack(env)).toBe(expected);
  });
});

describe('resolveUpdateFeed', () => {
  const telemetry = {
    platform: 'darwin' as const,
    arch: 'arm64',
    version: '2.219.8',
    source: 'dmg' as const,
    trigger: 'periodic' as const,
    daily: false,
    weekly: false,
    monthly: false,
    install: false,
    age: 'unknown' as const,
  };
  const base = {
    channel: 'stable' as const,
    githubBase: GITHUB_BASE,
    telemetryBase: TELEMETRY_BASE,
    telemetry,
    shareStatistics: true,
    githubFallbackActive: false,
    env: {},
  };

  it('uses the telemetry feed by default', () => {
    const feed = resolveUpdateFeed(base);
    expect(feed.kind).toBe('telemetry');
    expect(feed.url.startsWith(`${TELEMETRY_BASE}/stable?`)).toBe(true);
  });

  it('uses the GitHub feed when the toggle is off', () => {
    expect(resolveUpdateFeed({ ...base, shareStatistics: false })).toEqual({
      kind: 'github',
      url: `${GITHUB_BASE}/stable`,
    });
  });

  it('uses the GitHub feed when DO_NOT_TRACK=1 is set', () => {
    expect(resolveUpdateFeed({ ...base, env: { DO_NOT_TRACK: '1' } })).toEqual({
      kind: 'github',
      url: `${GITHUB_BASE}/stable`,
    });
  });

  it('uses the GitHub feed once the session has fallen back', () => {
    expect(resolveUpdateFeed({ ...base, githubFallbackActive: true }).kind).toBe('github');
  });

  it('a custom AUTO_UPDATE_URL bypasses the telemetry feed', () => {
    expect(
      resolveUpdateFeed({ ...base, env: { AUTO_UPDATE_URL: 'http://127.0.0.1:8080/feeds' } }),
    ).toEqual({ kind: 'custom', url: 'http://127.0.0.1:8080/feeds/stable' });
  });
});

describe('isAllowedUpdateUrl', () => {
  it.each([
    'https://updates.intentapp.dev/desktop/stable/latest-mac.yml?p=darwin-arm64',
    'https://updates.intentapp.dev/desktop/beta/Intent-3.0.0-arm64-mac.zip',
    'https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest.yml',
    'https://objects.githubusercontent.com/github-production-release-asset/123',
    'https://release-assets.githubusercontent.com/github-production-release-asset/456',
  ])('allows %s', (url) => {
    expect(isAllowedUpdateUrl(url)).toBe(true);
  });

  it.each([
    'https://evil.example.com/Intent.zip',
    'http://updates.intentapp.dev/desktop/stable/latest.yml',
    'https://updates.intentapp.dev/other/stable/latest.yml',
    'https://updates.intentapp.dev.evil.com/desktop/stable/latest.yml',
    'https://github.com/intent-hq/other-repo/releases/download/x',
    'https://github.com/intent-hq/cloudlands-releases-evil/releases/download/x',
    'https://githubusercontent.com.evil.com/x',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isAllowedUpdateUrl(url)).toBe(false);
  });

  it('allows an explicitly configured extra prefix (AUTO_UPDATE_URL)', () => {
    expect(isAllowedUpdateUrl('http://127.0.0.1:8080/feeds/stable/latest.yml')).toBe(false);
    expect(
      isAllowedUpdateUrl('http://127.0.0.1:8080/feeds/stable/latest.yml', [
        'http://127.0.0.1:8080/feeds',
      ]),
    ).toBe(true);
  });
});

describe('installUpdateRequestAllowlist', () => {
  type Listener = (
    details: { url: string },
    callback: (response: { cancel: boolean }) => void,
  ) => void;

  function fakeSession() {
    let listener: Listener | null = null;
    return {
      session: {
        webRequest: {
          onBeforeRequest: vi.fn((l: Listener) => {
            listener = l;
          }),
        },
      },
      request(url: string): boolean {
        if (!listener) throw new Error('no listener installed');
        let cancelled: boolean | undefined;
        listener({ url }, (response) => {
          cancelled = response.cancel;
        });
        if (cancelled === undefined) throw new Error('callback not invoked');
        return cancelled;
      },
    };
  }

  it('cancels a request (or redirect hop) to a foreign host on the updater session', () => {
    const fake = fakeSession();
    installUpdateRequestAllowlist(fake.session);
    expect(fake.request('https://evil.example.com/Intent-3.0.0.AppImage')).toBe(true);
  });

  it('lets approved feed and download hosts through', () => {
    const fake = fakeSession();
    installUpdateRequestAllowlist(fake.session);
    expect(fake.request('https://updates.intentapp.dev/desktop/stable/latest-linux.yml')).toBe(
      false,
    );
    expect(
      fake.request(
        'https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-linux.yml',
      ),
    ).toBe(false);
    expect(fake.request('https://objects.githubusercontent.com/asset')).toBe(false);
  });
});
