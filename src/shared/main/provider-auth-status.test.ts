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

import { __resetProviderAuthStatusForTests, getProviderAuthVerdicts } from './provider-auth-status';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('main provider auth status cache', () => {
  afterEach(() => {
    __resetProviderAuthStatusForTests();
    vi.clearAllMocks();
  });

  it('single-flights by argument set and refetches on event and reconnect', async () => {
    lifecycle.request.mockResolvedValue({
      providers: [{ id: 'codex', authenticated: true }],
    });

    const [first, second] = await Promise.all([
      getProviderAuthVerdicts({ providerId: 'codex' }),
      getProviderAuthVerdicts({ providerId: 'codex' }),
    ]);
    expect(first).toEqual({ codex: { authenticated: true } });
    expect(second).toEqual(first);
    await getProviderAuthVerdicts({ providerId: 'codex' });
    expect(lifecycle.request).toHaveBeenCalledTimes(1);

    lifecycle.notification?.({
      method: 'events.event',
      params: { event: { type: 'provider:auth-changed' } },
    });
    await getProviderAuthVerdicts({ providerId: 'codex' });
    lifecycle.reconnected?.();
    await getProviderAuthVerdicts({ providerId: 'codex' });

    expect(lifecycle.request).toHaveBeenCalledTimes(3);
    expect(lifecycle.request).toHaveBeenLastCalledWith('host.providerAuthStatus', {
      providerId: 'codex',
    });
  });

  it('coalesces an invalidated in-flight read into one fresh trailing request', async () => {
    let resolveOld!: (value: unknown) => void;
    lifecycle.request
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ providers: [{ id: 'codex', authenticated: true }] });

    const oldRead = getProviderAuthVerdicts({ providerId: 'codex' });
    lifecycle.notification?.({
      method: 'events.event',
      params: { event: { type: 'provider:auth-changed' } },
    });
    const freshRead = getProviderAuthVerdicts({ providerId: 'codex' });
    const sameFreshRead = getProviderAuthVerdicts({ providerId: 'codex' });
    resolveOld({ providers: [{ id: 'codex', authenticated: false }] });

    await expect(oldRead).resolves.toEqual({ codex: { authenticated: false } });
    await expect(freshRead).resolves.toEqual({ codex: { authenticated: true } });
    await expect(sameFreshRead).resolves.toEqual({ codex: { authenticated: true } });
    await expect(getProviderAuthVerdicts({ providerId: 'codex' })).resolves.toEqual({
      codex: { authenticated: true },
    });
    expect(lifecycle.request).toHaveBeenCalledTimes(2);
  });

  it('preserves force on a refresh queued behind a passive auth read', async () => {
    let resolveCached!: (value: unknown) => void;
    lifecycle.request
      .mockReturnValueOnce(new Promise((resolve) => (resolveCached = resolve)))
      .mockResolvedValueOnce({ providers: [{ id: 'codex', authenticated: true }] });

    const cachedRead = getProviderAuthVerdicts({ providerId: 'codex' });
    const freshRead = getProviderAuthVerdicts({ providerId: 'codex', force: true });
    resolveCached({ providers: [{ id: 'codex', authenticated: false }] });

    await expect(cachedRead).resolves.toEqual({ codex: { authenticated: false } });
    await expect(freshRead).resolves.toEqual({ codex: { authenticated: true } });
    expect(lifecycle.request).toHaveBeenNthCalledWith(1, 'host.providerAuthStatus', {
      providerId: 'codex',
    });
    expect(lifecycle.request).toHaveBeenNthCalledWith(2, 'host.providerAuthStatus', {
      providerId: 'codex',
      force: true,
    });
  });

  it('serves the newest verdict after two invalidations without concurrent reads', async () => {
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
      .mockImplementationOnce(() =>
        track(Promise.resolve({ providers: [{ id: 'codex', authenticated: true }] })),
      );

    const initialRead = getProviderAuthVerdicts({ providerId: 'codex' });
    lifecycle.notification?.({
      method: 'events.event',
      params: { event: { type: 'provider:auth-changed' } },
    });
    const middleRead = getProviderAuthVerdicts({ providerId: 'codex' });
    first.resolve({ providers: [{ id: 'codex', authenticated: false }] });
    await vi.waitFor(() => expect(lifecycle.request).toHaveBeenCalledTimes(2));
    lifecycle.notification?.({
      method: 'events.event',
      params: { event: { type: 'provider:auth-changed' } },
    });
    const newestRead = getProviderAuthVerdicts({ providerId: 'codex' });
    second.resolve({ providers: [{ id: 'codex', authenticated: false }] });

    await initialRead;
    await middleRead;
    await expect(newestRead).resolves.toEqual({ codex: { authenticated: true } });
    expect(maxActiveReads).toBe(1);
    expect(lifecycle.request).toHaveBeenCalledTimes(3);
  });

  it('does not cache transport failures as unknown verdicts', async () => {
    lifecycle.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ providers: [{ id: 'codex', authenticated: true }] });

    await expect(getProviderAuthVerdicts({ providerId: 'codex' })).resolves.toEqual({});
    await expect(getProviderAuthVerdicts({ providerId: 'codex' })).resolves.toEqual({
      codex: { authenticated: true },
    });
    expect(lifecycle.request).toHaveBeenCalledTimes(2);
  });
});
