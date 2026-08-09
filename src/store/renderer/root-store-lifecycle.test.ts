import type { Store } from '@augmentcode/themis/svelte-store';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { _resetRendererStoreBridge } from './renderer-store-bridge';
import { startRootStoreLifecycle } from './root-store-lifecycle';

function createStore(order: string[]): Store<any, any> {
  return {
    init: vi.fn(() => {
      order.push('store:init');
      return () => order.push('store:dispose');
    }),
    state: {},
    dispatch: vi.fn(),
  } as unknown as Store<any, any>;
}

afterEach(() => {
  _resetRendererStoreBridge();
});

describe('root Store lifecycle', () => {
  it('completes Store.init before starting app sagas', () => {
    const order: string[] = [];
    const store = createStore(order);

    const dispose = startRootStoreLifecycle(store, {
      startSagas: () => {
        order.push('sagas:start');
        return [];
      },
    });

    expect(order).toEqual(['store:init', 'sagas:start']);
    dispose();
  });

  it('stops every saga before Store disposal', () => {
    const order: string[] = [];
    const store = createStore(order);
    const dispose = startRootStoreLifecycle(store, {
      startSagas: () => [() => order.push('saga:stop:one'), () => order.push('saga:stop:two')],
    });

    order.length = 0;
    dispose();

    expect(order).toEqual(['saga:stop:one', 'saga:stop:two', 'store:dispose']);
  });
});
