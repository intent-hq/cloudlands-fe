/**
 * Regression for intent-hq/intent#5362: the `github.authStatus` cache used to
 * live forever, so a missed `github:auth-changed` event (or reconnect) left
 * every consumer — including the device-flow `POLL_FOR_TOKEN` loop — reading
 * the first snapshot until the flow's client-side expiry. The cache now has a
 * bounded TTL so a dropped event self-heals on the next read past it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import {
  __resetGitHubAuthStatusForTests,
  GITHUB_AUTH_STATUS_TTL_MS,
  readGitHubAuthStatus,
} from './github-auth-status.client';

const mockedRequest = vi.mocked(backendRequest);

const PENDING = {
  isConfigured: true,
  oauthUrl: 'https://github.com/login/device',
  configuredButNeedsUpdate: false,
  updatedScopes: '',
  deviceFlow: {
    status: 'pending' as const,
    userCode: 'WXYZ-5678',
    verificationUri: 'https://github.com/login/device',
    expiresIn: 899,
    interval: 5,
  },
};
const AUTHORIZED = { ...PENDING, oauthUrl: '', deviceFlow: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('readGitHubAuthStatus cache TTL (#5362)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetGitHubAuthStatusForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('serves the cached snapshot without a refetch while the TTL has not elapsed', async () => {
    mockedRequest.mockResolvedValue(PENDING);

    await expect(readGitHubAuthStatus()).resolves.toEqual(PENDING);
    vi.advanceTimersByTime(GITHUB_AUTH_STATUS_TTL_MS - 1);
    await expect(readGitHubAuthStatus()).resolves.toEqual(PENDING);

    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL elapses even though no github:auth-changed event arrived', async () => {
    mockedRequest.mockResolvedValueOnce(PENDING).mockResolvedValueOnce(AUTHORIZED);

    await expect(readGitHubAuthStatus()).resolves.toEqual(PENDING);
    vi.advanceTimersByTime(GITHUB_AUTH_STATUS_TTL_MS);
    await expect(readGitHubAuthStatus()).resolves.toEqual(AUTHORIZED);

    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest).toHaveBeenLastCalledWith('github.authStatus');
  });

  it('single-flights concurrent reads of a stale cache into one request', async () => {
    const refetch = deferred<typeof AUTHORIZED>();
    mockedRequest
      .mockResolvedValueOnce(PENDING)
      .mockImplementationOnce(() => refetch.promise as Promise<never>);

    await readGitHubAuthStatus();
    vi.advanceTimersByTime(GITHUB_AUTH_STATUS_TTL_MS);

    const first = readGitHubAuthStatus();
    const second = readGitHubAuthStatus();
    expect(mockedRequest).toHaveBeenCalledTimes(2);

    refetch.resolve(AUTHORIZED);
    await expect(first).resolves.toEqual(AUTHORIZED);
    await expect(second).resolves.toEqual(AUTHORIZED);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it('restarts the TTL from the refetch, not from the original read', async () => {
    mockedRequest.mockResolvedValue(PENDING);

    await readGitHubAuthStatus();
    vi.advanceTimersByTime(GITHUB_AUTH_STATUS_TTL_MS);
    await readGitHubAuthStatus();
    expect(mockedRequest).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(GITHUB_AUTH_STATUS_TTL_MS - 1);
    await readGitHubAuthStatus();
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });
});
