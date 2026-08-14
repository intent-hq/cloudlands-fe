import type { Store } from '@augmentcode/themis/svelte-store';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { _resetRendererStoreBridge } from './renderer-store-bridge';
import { startRootStoreLifecycle, type RootStoreHmrData } from './root-store-lifecycle';

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

  it('keeps one Store owner while replacing sagas across HMR generations', () => {
    const order: string[] = [];
    const store = createStore(order);
    const hmrData: RootStoreHmrData = {};
    const firstDispose = startRootStoreLifecycle(
      store,
      {
        startSagas: () => {
          order.push('sagas:start:first');
          return [() => order.push('sagas:stop:first')];
        },
      },
      hmrData,
    );

    firstDispose();
    const secondDispose = startRootStoreLifecycle(
      store,
      {
        startSagas: () => {
          order.push('sagas:start:second');
          return [() => order.push('sagas:stop:second')];
        },
      },
      hmrData,
    );
    secondDispose();

    expect(order).toEqual([
      'store:init',
      'sagas:start:first',
      'sagas:stop:first',
      'sagas:start:second',
    ]);
    hmrData.rootStoreStop?.();
    hmrData.rootStoreStop?.();
    expect(order.slice(-2)).toEqual(['sagas:stop:second', 'store:dispose']);
  });

  it('stops legacy hot ownership before it initializes the retained owner', () => {
    const order: string[] = [];
    const store = createStore(order);
    const hmrData: RootStoreHmrData = { rootStoreStop: () => order.push('legacy:stop') };

    startRootStoreLifecycle(store, { startSagas: () => [] }, hmrData);

    expect(order).toEqual(['legacy:stop', 'store:init']);
  });
});
