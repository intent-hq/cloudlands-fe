/**
 * A generic update feed whose manifest request can be aborted.
 *
 * electron-updater 6.x gives a check no cancellation handle: the feed request
 * runs on a fresh token, and later checks are deduplicated onto it until it
 * settles. A slow telemetry host would therefore hold every check until the
 * socket's own 60-second timeout. Pointing the updater at this provider
 * through its supported `provider: 'custom'` hook passes our token to the
 * HTTP executor, so cancelling it aborts the request (including any redirect
 * hop) and rejects the check, which also releases the deduplicated promise.
 *
 * Everything else, including how installers resolve from the feed URL, is
 * electron-updater's own GenericProvider.
 */

import type { CancellationToken } from 'electron-updater';
import type { AppUpdater } from 'electron-updater/out/AppUpdater.js';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider.js';
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider.js';
import type { OutgoingHttpHeaders } from 'http';
import type { URL } from 'url';

/** `setFeedURL` options for a feed whose manifest request `token` can abort. */
export interface CancellableFeedOptions {
  provider: 'custom';
  url: string;
  updateProvider: typeof CancellableGenericProvider;
  feedCancellationToken: CancellationToken;
}

export class CancellableGenericProvider extends GenericProvider {
  private readonly feedCancellationToken: CancellationToken;

  constructor(
    options: CancellableFeedOptions,
    updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super({ provider: 'generic', url: options.url }, updater, runtimeOptions);
    this.feedCancellationToken = options.feedCancellationToken;
  }

  protected override httpRequest(
    url: URL,
    headers?: OutgoingHttpHeaders | null,
    cancellationToken?: CancellationToken,
  ): Promise<string | null> {
    return super.httpRequest(url, headers, cancellationToken ?? this.feedCancellationToken);
  }
}

export function cancellableFeedOptions(
  url: string,
  feedCancellationToken: CancellationToken,
): CancellableFeedOptions {
  return {
    provider: 'custom',
    url,
    updateProvider: CancellableGenericProvider,
    feedCancellationToken,
  };
}
