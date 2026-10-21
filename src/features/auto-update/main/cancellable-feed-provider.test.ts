/**
 * The telemetry feed provider must hand our token to electron-updater's HTTP
 * executor so cancelling it aborts the manifest request, while resolving
 * files exactly like electron-updater's own GenericProvider.
 */

import { describe, expect, it, vi } from 'vitest';
import { CancellationToken } from 'electron-updater/out/types.js';
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider.js';
import { CancellableGenericProvider, cancellableFeedOptions } from './cancellable-feed-provider';

const FEED =
  'https://updates.intentapp.dev/desktop/stable?p=linux-x64&v=2.219.8&src=appimage&k=manual&d=1';
const CHANNEL_YML =
  'version: 9.9.9\npath: Intent.AppImage\nsha512: abc\nfiles:\n  - url: Intent-9.9.9.AppImage\n    sha512: abc\n';
const UPDATER = { channel: null, isAddNoCacheQuery: false } as never;

function pendingExecutor() {
  const abort = vi.fn();
  const tokens: Array<CancellationToken | undefined> = [];
  const executor = {
    request: vi.fn((_options: unknown, token?: CancellationToken) => {
      tokens.push(token);
      return (token ?? new CancellationToken()).createPromise<string>(
        (_resolve, _reject, onCancel) => onCancel(abort),
      );
    }),
  };
  const runtime = { executor, platform: 'linux', isUseMultipleRangeRequest: true } as never;
  return { executor, runtime, abort, tokens };
}

describe('CancellableGenericProvider', () => {
  it('aborts the pending manifest request when the feed token is cancelled', async () => {
    const token = new CancellationToken();
    const { runtime, abort, tokens } = pendingExecutor();
    const provider = new CancellableGenericProvider(
      cancellableFeedOptions(FEED, token),
      UPDATER,
      runtime,
    );

    const check = provider.getLatestVersion();
    await Promise.resolve();
    expect(tokens).toEqual([token]);
    token.cancel();

    const error = await check.then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as Error).constructor.name).toBe('CancellationError');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('keeps a token electron-updater passes explicitly', async () => {
    const feedToken = new CancellationToken();
    const callerToken = new CancellationToken();
    const { runtime, tokens } = pendingExecutor();
    const provider = new CancellableGenericProvider(
      cancellableFeedOptions(FEED, feedToken),
      UPDATER,
      runtime,
    );

    void (
      provider as unknown as {
        httpRequest(url: URL, headers: null, token: CancellationToken): Promise<unknown>;
      }
    )
      .httpRequest(new URL(FEED), null, callerToken)
      .catch(() => undefined);
    expect(tokens).toEqual([callerToken]);
    callerToken.cancel();
  });

  it('resolves files like GenericProvider, keeping the counted query string', async () => {
    const executor = { request: vi.fn(async () => CHANNEL_YML) };
    const runtime = { executor, platform: 'linux', isUseMultipleRangeRequest: true } as never;
    const ours = new CancellableGenericProvider(
      cancellableFeedOptions(FEED, new CancellationToken()),
      UPDATER,
      runtime,
    );
    const generic = new GenericProvider({ provider: 'generic', url: FEED }, UPDATER, runtime);

    const info = await ours.getLatestVersion();
    expect(info.version).toBe('9.9.9');
    const files = ours.resolveFiles(info).map((f) => f.url.href);
    expect(files).toEqual(generic.resolveFiles(info).map((f) => f.url.href));
    expect(new URL(files[0]).searchParams.get('k')).toBe('manual');
  });
});
