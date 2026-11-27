// @verify-changed-triggers: src/lib/client/live/backend-transport.ts
import { describe, expect, it, vi } from 'vitest';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { createBackendTransportFake } from '../backend-transport-fake';

describe('createBackendTransportFake', () => {
  // A new transport export must be filled here, not in every hand-written fake
  // (cloudlands-fe#5090 broke 19 files by adding readBackendHello).
  it('fills every runtime export of the real transport module', async () => {
    const real = await vi.importActual<Record<string, unknown>>(
      '$lib/client/live/backend-transport',
    );
    const fake = createBackendTransportFake();
    const missing = Object.keys(real).filter((name) => !(name in fake));
    expect(missing, 'add a default for these exports to backend-transport-fake.ts').toEqual([]);
    for (const name of Object.keys(real)) {
      expect(typeof fake[name as keyof typeof fake], name).toBe(typeof real[name]);
    }
  });

  it('returns the overrides themselves so tests can drive their mocks', () => {
    const backendRequest = vi.fn();
    const extra = () => true;
    const fake = createBackendTransportFake({ backendRequest, isBackendAvailable: extra });
    expect(fake.backendRequest).toBe(backendRequest);
    expect(fake.isBackendAvailable).toBe(extra);
  });

  it('answers readBackendHello from the given backendRequest without an extra tick', () => {
    const reply = Promise.resolve({ server: { capabilities: { liveState: true } } });
    const backendRequest = vi.fn(() => reply);
    const fake = createBackendTransportFake({ backendRequest });
    expect(fake.readBackendHello()).toBe(reply);
    expect(backendRequest).toHaveBeenCalledWith('client.hello', {});
  });

  it('keeps an explicit readBackendHello override', async () => {
    const backendRequest = vi.fn();
    const fake = createBackendTransportFake({
      backendRequest,
      readBackendHello: async () => ({ own: true }),
    });
    await expect(fake.readBackendHello()).resolves.toEqual({ own: true });
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects an unscripted request loudly with a BackendError', async () => {
    const fake = createBackendTransportFake();
    await expect(fake.backendRequest('agent.list', {})).rejects.toMatchObject({
      name: 'BackendError',
      code: 'MOCK_UNHANDLED_METHOD',
    });
  });

  it('rejects optional captures as a transport without them does', async () => {
    const fake = createBackendTransportFake();
    const root = { workspaceId: 'ws-1', gitRootId: 'root-1' } as never;
    const cases: Array<[Promise<unknown>, string]> = [
      [fake.captureBackendRepositoryResource('ws-1'), 'REPOSITORY_RESOURCE_UNAVAILABLE'],
      [fake.captureBackendRepositoryRoute(root), 'REPOSITORY_ROUTE_UNAVAILABLE'],
      [fake.captureBackendRepositorySelection(root), 'REPOSITORY_SELECTION_UNAVAILABLE'],
      [fake.captureBackendRepositoryCheckout({} as never), 'REPOSITORY_CHECKOUT_UNAVAILABLE'],
      [fake.prepareBackendNativeReview({} as never), 'NATIVE_REVIEW_UNAVAILABLE'],
      [fake.capturePrMonitorSession('ws-1'), 'PR_MONITOR_SESSION_UNAVAILABLE'],
      [fake.readBackendPrincipal(), 'UNAVAILABLE'],
    ];
    for (const [pending, code] of cases) {
      const error = await pending.catch((caught: unknown) => caught);
      expect(error, code).toBeInstanceOf(BackendError);
      expect((error as BackendError).code).toBe(code);
    }
  });

  it('gives listeners disposers and routes monitor reconnects to the reconnect override', () => {
    const disposer = () => {};
    const onBackendReconnected = vi.fn(() => disposer);
    const fake = createBackendTransportFake({ onBackendReconnected });
    const handler = () => {};
    expect(fake.onMonitorReconnected(handler)).toBe(disposer);
    expect(onBackendReconnected).toHaveBeenCalledWith(handler);
    expect(typeof createBackendTransportFake().onBackendNotification(() => {})).toBe('function');
  });

  it('builds independent fakes', () => {
    const first = createBackendTransportFake();
    const second = createBackendTransportFake();
    expect(first.backendSubscribe).not.toBe(second.backendSubscribe);
  });
});
