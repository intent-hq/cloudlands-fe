/**
 * Regression: electron-updater 6.x attaches the persistent `.updaterId` as
 * `x-user-staging-id` to every feed request. Requests to the telemetry host
 * must leave the updater session without it (including redirect hops back to
 * that host), while direct GitHub requests keep electron-updater's headers.
 *
 * The headers come from electron-updater's own `getUpdateInfoAndProvider` and
 * `GenericProvider`, so a change in how the library builds them is caught.
 */

import { describe, expect, it, vi } from 'vitest';
import { AppUpdater } from 'electron-updater/out/AppUpdater';
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider';
import { installTelemetryHeaderFilter } from './update-telemetry';

const STAGING_ID = '6f1c3c2e-6f0a-4b7e-9d55-3c1b2a9e8f10';
const CHANNEL_YML =
  'version: 9.9.9\npath: Intent.AppImage\nsha512: abc\nfiles:\n  - url: Intent.AppImage\n    sha512: abc\n';

type Headers = Record<string, string>;
type BeforeSendHeadersListener = (
  details: { url: string; requestHeaders: Headers },
  callback: (response: { requestHeaders: Headers }) => void,
) => void;

/** One feed request as electron-updater builds it: target URL + headers. */
async function realFeedRequest(feedUrl: string): Promise<{ url: string; headers: Headers }> {
  let captured: { url: string; headers: Headers } | null = null;
  const executor = {
    request: vi.fn(
      async (options: { protocol: string; hostname: string; path: string; headers?: Headers }) => {
        captured = {
          url: `${options.protocol}//${options.hostname}${options.path}`,
          headers: { ...(options.headers ?? {}) },
        };
        return CHANNEL_YML;
      },
    ),
  };
  const provider = new GenericProvider(
    { provider: 'generic', url: feedUrl },
    { channel: null, isAddNoCacheQuery: false } as never,
    { executor, platform: 'linux', isUseMultipleRangeRequest: true } as never,
  );
  const updaterThis = {
    app: { whenReady: async () => undefined },
    clientPromise: Promise.resolve(provider),
    stagingUserIdPromise: { value: Promise.resolve(STAGING_ID) },
    requestHeaders: null,
    computeFinalHeaders: (AppUpdater.prototype as unknown as { computeFinalHeaders: unknown })
      .computeFinalHeaders,
  };
  await (
    AppUpdater.prototype as unknown as { getUpdateInfoAndProvider(this: unknown): Promise<unknown> }
  ).getUpdateInfoAndProvider.call(updaterThis);
  if (!captured) throw new Error('electron-updater issued no feed request');
  return captured;
}

function fakeUpdaterSession() {
  let listener: BeforeSendHeadersListener | null = null;
  const session = {
    webRequest: {
      onBeforeSendHeaders: vi.fn((l: BeforeSendHeadersListener) => {
        listener = l;
      }),
    },
  };
  /** Headers as they actually leave the session after the hook runs. */
  const send = (url: string, requestHeaders: Headers): Headers => {
    if (!listener) throw new Error('no header hook installed');
    let sent: Headers | undefined;
    listener({ url, requestHeaders }, (response) => {
      sent = response.requestHeaders;
    });
    if (!sent) throw new Error('callback not invoked');
    return sent;
  };
  return { session, send };
}

const lowerKeys = (headers: Headers) => Object.keys(headers).map((k) => k.toLowerCase());

describe('installTelemetryHeaderFilter', () => {
  it('electron-updater really attaches the persistent staging id to feed requests', async () => {
    const request = await realFeedRequest(
      'https://updates.intentapp.dev/desktop/stable?p=linux-x64',
    );
    expect(request.headers['x-user-staging-id']).toBe(STAGING_ID);
  });

  it('strips the staging id from real telemetry feed requests', async () => {
    const fake = fakeUpdaterSession();
    installTelemetryHeaderFilter(fake.session);
    const request = await realFeedRequest(
      'https://updates.intentapp.dev/desktop/stable?p=linux-x64&v=2.219.8&src=appimage&k=manual&d=1',
    );
    expect(new URL(request.url).hostname).toBe('updates.intentapp.dev');
    const sent = fake.send(request.url, request.headers);
    expect(lowerKeys(sent)).not.toContain('x-user-staging-id');
    expect(Object.values(sent)).not.toContain(STAGING_ID);
  });

  it('strips the header case-insensitively, including on a redirect hop back to the telemetry host', () => {
    const fake = fakeUpdaterSession();
    installTelemetryHeaderFilter(fake.session);
    const sent = fake.send('https://updates.intentapp.dev/desktop/stable/Intent.AppImage?p=x', {
      'X-User-Staging-Id': STAGING_ID,
      'User-Agent': 'electron-builder',
    });
    expect(sent).toEqual({ 'User-Agent': 'electron-builder' });
  });

  it('keeps electron-updater headers on direct GitHub requests', async () => {
    const fake = fakeUpdaterSession();
    installTelemetryHeaderFilter(fake.session);
    const request = await realFeedRequest(
      'https://github.com/intent-hq/cloudlands-releases/releases/download/stable',
    );
    expect(fake.send(request.url, request.headers)['x-user-staging-id']).toBe(STAGING_ID);
  });
});
