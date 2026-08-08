/**
 * Provider models cache seeder tests.
 *
 * Pins mock-harness parity with the production reconnect invalidation owned
 * by `daemonEventsSaga`: the seeder performs NO connect-time hydration and
 * clears the session cache on every backend reconnect.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppClient } from '$lib/client';
import type { Store } from '@augmentcode/themis/svelte-store';

// FAKE transport seam: capture the reconnect handler so tests can fire it.
const reconnectHandlers: Array<() => void> = [];
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendReconnected: vi.fn((handler: () => void) => {
    reconnectHandlers.push(handler);
    return () => {
      const i = reconnectHandlers.indexOf(handler);
      if (i >= 0) reconnectHandlers.splice(i, 1);
    };
  }),
}));

import { seedMockStore } from '../mock-bootstrap';
import { providerModelsCacheCleared } from '../slices/provider-models/provider-models-slice';

function makeHarness() {
  const dispatch = vi.fn();
  const store = { dispatch } as unknown as Store<any, any>;
  const client = {} as unknown as AppClient;
  return { store, client, dispatch };
}

describe('provider-models-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockSeeder` side effect. The
    // barrel is intentionally NOT imported, so only this seeder is registered.
    await import('./provider-models-seeder');
  });

  afterEach(() => {
    vi.clearAllMocks();
    reconnectHandlers.length = 0;
  });

  it('registers the mock reconnect listener without dispatching at seed time', async () => {
    const { store, client, dispatch } = makeHarness();

    await seedMockStore(store, client);

    expect(reconnectHandlers.length).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps mock stores in parity by clearing on every backend reconnect', async () => {
    const { store, client, dispatch } = makeHarness();

    await seedMockStore(store, client);

    reconnectHandlers[0]();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(providerModelsCacheCleared());

    reconnectHandlers[0]();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('re-seeding replaces the previous reconnect listener (no double dispatch)', async () => {
    const { store, client, dispatch } = makeHarness();

    await seedMockStore(store, client);
    await seedMockStore(store, client);

    expect(reconnectHandlers.length).toBe(1);
    reconnectHandlers[0]();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
