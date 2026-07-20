import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppClient } from '$lib/client';
import type { Store } from '$lib/store-shim/svelte-store';

import {
  clearMockSeeders,
  getRegisteredMockSeeders,
  registerMockSeeder,
  seedMockStore,
  type MockSeederContext,
} from './mock-bootstrap';

/** Minimal store stub: only `dispatch` is exercised by seeders. */
function createStoreStub(): Store<any, any> {
  return { dispatch: vi.fn() } as unknown as Store<any, any>;
}

/** Minimal client stub; seeders only need an object reference here. */
function createClientStub(): AppClient {
  return {} as unknown as AppClient;
}

describe('mock-bootstrap', () => {
  beforeEach(() => {
    clearMockSeeders();
  });

  describe('registry', () => {
    it('starts empty', () => {
      expect(getRegisteredMockSeeders()).toEqual([]);
    });

    it('registers seeders in registration order', () => {
      registerMockSeeder('alpha', () => {});
      registerMockSeeder('beta', () => {});
      expect(getRegisteredMockSeeders()).toEqual(['alpha', 'beta']);
    });

    it('replaces a seeder registered under the same name (idempotent)', () => {
      const first = vi.fn();
      const second = vi.fn();
      registerMockSeeder('dup', first);
      registerMockSeeder('dup', second);

      expect(getRegisteredMockSeeders()).toEqual(['dup']);
    });

    it('clears all registered seeders', () => {
      registerMockSeeder('alpha', () => {});
      clearMockSeeders();
      expect(getRegisteredMockSeeders()).toEqual([]);
    });
  });

  describe('seedMockStore', () => {
    it('runs every registered seeder with the store and client', async () => {
      const store = createStoreStub();
      const client = createClientStub();
      const seen: MockSeederContext[] = [];

      registerMockSeeder('one', (ctx) => {
        seen.push(ctx);
      });
      registerMockSeeder('two', (ctx) => {
        seen.push(ctx);
      });

      await seedMockStore(store, client);

      expect(seen).toHaveLength(2);
      expect(seen[0]).toEqual({ store, client });
      expect(seen[1]).toEqual({ store, client });
    });

    it('runs seeders sequentially in registration order', async () => {
      const order: string[] = [];

      registerMockSeeder('first', async () => {
        await Promise.resolve();
        order.push('first');
      });
      registerMockSeeder('second', () => {
        order.push('second');
      });

      await seedMockStore(createStoreStub(), createClientStub());

      expect(order).toEqual(['first', 'second']);
    });

    it('awaits async seeders before resolving', async () => {
      let done = false;
      registerMockSeeder('async', async () => {
        await Promise.resolve();
        done = true;
      });

      await seedMockStore(createStoreStub(), createClientStub());

      expect(done).toBe(true);
    });

    it('resolves without error when no seeders are registered', async () => {
      await expect(seedMockStore(createStoreStub(), createClientStub())).resolves.toBeUndefined();
    });

    it('propagates errors thrown by a seeder', async () => {
      registerMockSeeder('boom', () => {
        throw new Error('seed failed');
      });

      await expect(seedMockStore(createStoreStub(), createClientStub())).rejects.toThrow(
        'seed failed',
      );
    });
  });
});
