import { afterEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({
  notification: undefined as
    ((notification: { method: string; params?: unknown }) => void) | undefined,
  reconnected: undefined as (() => void) | undefined,
  request: vi.fn(),
}));

vi.mock('../../features/backend/main/backend.ipc', () => ({
  getBackendClient: vi.fn(() => ({ request: lifecycle.request })),
  onBackendNotification: vi.fn((handler) => {
    lifecycle.notification = handler;
    return () => {};
  }),
  onBackendReconnected: vi.fn((handler) => {
    lifecycle.reconnected = handler;
    return () => {};
  }),
}));

import { __resetGitHubAuthStatusForTests, isGitHubConfigured } from './github-auth-status';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('main GitHub auth status cache', () => {
  afterEach(() => {
    __resetGitHubAuthStatusForTests();
    vi.clearAllMocks();
  });

  it('single-flights and refetches on auth events and reconnects', async () => {
    lifecycle.request.mockResolvedValue({ isConfigured: true });

    const [first, second] = await Promise.all([isGitHubConfigured(), isGitHubConfigured()]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    await isGitHubConfigured();
    expect(lifecycle.request).toHaveBeenCalledTimes(1);

    lifecycle.notification?.({
      method: 'events.event',
      params: { event: { type: 'github:auth-changed' } },
    });
    await isGitHubConfigured();
    lifecycle.reconnected?.();
    await isGitHubConfigured();

    expect(lifecycle.request).toHaveBeenCalledTimes(3);
    expect(lifecycle.request).toHaveBeenLastCalledWith('github.authStatus');
  });

  it('coalesces an invalidated in-flight read into one fresh trailing request', async () => {
    let resolveOld!: (value: unknown) => void;
    lifecycle.request
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ isConfigured: true });

    const oldRead = isGitHubConfigured();
    lifecycle.notification?.({
      method: 'events.event',
      params: { event: { type: 'github:auth-changed' } },
    });
    const freshRead = isGitHubConfigured();
    const sameFreshRead = isGitHubConfigured();
    resolveOld({ isConfigured: false });

    await expect(oldRead).resolves.toBe(false);
    await expect(freshRead).resolves.toBe(true);
    await expect(sameFreshRead).resolves.toBe(true);
    await expect(isGitHubConfigured()).resolves.toBe(true);
    expect(lifecycle.request).toHaveBeenCalledTimes(2);
  });

  it('serves the newest status after two invalidations without concurrent reads', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    let activeReads = 0;
    let maxActiveReads = 0;
    const track = (promise: Promise<unknown>) => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      return promise.finally(() => (activeReads -= 1));
    };
    lifecycle.request
      .mockImplementationOnce(() => track(first.promise))
      .mockImplementationOnce(() => track(second.promise))
      .mockImplementationOnce(() => track(Promise.resolve({ isConfigured: true })));

    const initialRead = isGitHubConfigured();
    lifecycle.notification?.({
      method: 'events.event',
      params: { event: { type: 'github:auth-changed' } },
    });
    const middleRead = isGitHubConfigured();
    first.resolve({ isConfigured: false });
    await vi.waitFor(() => expect(lifecycle.request).toHaveBeenCalledTimes(2));
    lifecycle.notification?.({
      method: 'events.event',
      params: { event: { type: 'github:auth-changed' } },
    });
    const newestRead = isGitHubConfigured();
    second.resolve({ isConfigured: false });

    await initialRead;
    await middleRead;
    await expect(newestRead).resolves.toBe(true);
    expect(maxActiveReads).toBe(1);
    expect(lifecycle.request).toHaveBeenCalledTimes(3);
  });

  it('does not cache transport failures as unauthenticated', async () => {
    lifecycle.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ isConfigured: true });

    await expect(isGitHubConfigured()).resolves.toBe(false);
    await expect(isGitHubConfigured()).resolves.toBe(true);
    expect(lifecycle.request).toHaveBeenCalledTimes(2);
  });
});
