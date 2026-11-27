import { vi } from 'vitest';
import { BackendError } from '$lib/client/live/backend-transport-types';
import type * as BackendTransport from '$lib/client/live/backend-transport';

/**
 * A complete fake of `$lib/client/live/backend-transport` built from only the
 * exports a test cares about. Every other export gets a default, so adding a
 * transport export means adding its default here instead of editing every
 * hand-written `vi.mock` factory (cloudlands-fe#5090 broke 19 of them).
 *
 * ```ts
 * const backendRequest = vi.hoisted(() => vi.fn());
 * vi.mock('$lib/client/live/backend-transport', async () =>
 *   (await import('<path>/test/mocks/backend-transport-fake')).createBackendTransportFake({
 *     backendRequest,
 *   }),
 * );
 * ```
 *
 * - Overrides are returned as given, so `vi.mocked(backendRequest)` and
 *   imports from the mocked module see the same function.
 * - `readBackendHello` answers from the fake's `backendRequest('client.hello', {})`
 *   synchronously, so a test's scripted hello reply drives capability reads
 *   without an extra async tick.
 * - Optional captures reject with the real `BackendError` codes, as a transport
 *   without that capability does. An unscripted `backendRequest` rejects with
 *   `MOCK_UNHANDLED_METHOD`.
 *
 * For a scripted daemon with request handlers and pushed events, use
 * `mockBackendTransportModule` from `backend-transport.mock.ts` instead.
 */
type BackendTransportModule = typeof BackendTransport;

type FakeOverrides = { [K in keyof BackendTransportModule]?: unknown } & Record<string, unknown>;

export type BackendTransportFake<O extends FakeOverrides> = Omit<BackendTransportModule, keyof O> &
  O;

function unavailable(code: string, message = code) {
  return () => Promise.reject(new BackendError({ code, message }));
}

export function createBackendTransportFake<O extends FakeOverrides = Record<never, never>>(
  overrides: O = {} as O,
): BackendTransportFake<O> {
  const fake: Record<string, unknown> = {};
  let subscriptions = 0;
  const request = () =>
    fake.backendRequest as (method: string, params?: unknown) => Promise<unknown>;
  const reconnected = () => fake.onBackendReconnected as (handler: () => void) => () => void;
  const defaults = {
    backendRequest: vi.fn(async (method: string) => {
      throw new BackendError({
        code: 'MOCK_UNHANDLED_METHOD',
        message: `createBackendTransportFake: no backendRequest override for "${method}"`,
      });
    }),
    readBackendHello: () => request()('client.hello', {}),
    readBackendPrincipal: vi.fn(unavailable('UNAVAILABLE', 'Principal discovery unavailable')),
    observeBackendNodeCapabilities: vi.fn(async () => ({ server: { capabilities: {} } })),
    backendSubscribe: vi.fn(async () => ({ subscriptionId: `fake-sub-${++subscriptions}` })),
    backendUnsubscribe: vi.fn(async () => {}),
    detectLiveStateCapability: vi.fn(async () => false),
    onBackendNotification: vi.fn(() => () => {}),
    onBackendReconnected: vi.fn(() => () => {}),
    onMonitorReconnected: (handler: () => void) => reconnected()(handler),
    electronAPI: vi.fn(() => (typeof window !== 'undefined' ? window.electronAPI : undefined)),
    captureBackendRepositoryResource: vi.fn(unavailable('REPOSITORY_RESOURCE_UNAVAILABLE')),
    captureBackendRepositoryRoute: vi.fn(
      unavailable('REPOSITORY_ROUTE_UNAVAILABLE', 'Repository route unavailable'),
    ),
    captureBackendRepositorySelection: vi.fn(unavailable('REPOSITORY_SELECTION_UNAVAILABLE')),
    captureBackendRepositoryCheckout: vi.fn(unavailable('REPOSITORY_CHECKOUT_UNAVAILABLE')),
    prepareBackendNativeReview: vi.fn(unavailable('NATIVE_REVIEW_UNAVAILABLE')),
    capturePrMonitorSession: vi.fn(
      unavailable('PR_MONITOR_SESSION_UNAVAILABLE', 'Monitor transport unavailable'),
    ),
    prMonitorBackendId: vi.fn(() => undefined),
  } satisfies Record<keyof BackendTransportModule, unknown>;
  Object.assign(fake, defaults, overrides);
  return fake as BackendTransportFake<O>;
}
