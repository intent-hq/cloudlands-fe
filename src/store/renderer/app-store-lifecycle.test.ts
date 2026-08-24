import type { Store } from '@augmentcode/themis/svelte-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startAllAppSagas: vi.fn<() => Array<() => void>>(() => []),
  stopRetentionFingerprint: vi.fn(),
  startRetentionFingerprint: vi.fn(),
}));

vi.mock('./sagas', () => ({ startAllAppSagas: mocks.startAllAppSagas }));
vi.mock('./retention-fingerprint', () => ({
  startRetentionFingerprint: mocks.startRetentionFingerprint,
}));

import { _resetRendererStoreBridge } from './renderer-store-bridge';
import { startRootStoreLifecycle } from './root-store-lifecycle';
import { startAppStoreLifecycle, type AppStoreHmrData } from './app-store-lifecycle';

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

describe('app Store lifecycle', () => {
  beforeEach(() => {
    mocks.startAllAppSagas.mockReset();
    mocks.stopRetentionFingerprint.mockReset();
    mocks.startRetentionFingerprint.mockReset();
    mocks.startRetentionFingerprint.mockReturnValue(mocks.stopRetentionFingerprint);
  });

  afterEach(() => _resetRendererStoreBridge());

  it('starts app sagas after the shared root Store is initialized', () => {
    const order: string[] = [];
    const store = createStore(order);
    mocks.startAllAppSagas.mockImplementation(() => {
      order.push('sagas:start');
      return [];
    });

    const disposeRoot = startRootStoreLifecycle(store, { startSagas: () => [] });
    const disposeApp = startAppStoreLifecycle(store);

    expect(order).toEqual(['store:init', 'sagas:start']);
    expect(mocks.startRetentionFingerprint).toHaveBeenCalledWith(store);
    disposeApp();
    disposeRoot();
  });

  it('stops every app saga once when the app route unmounts', () => {
    const stopOne = vi.fn();
    const stopTwo = vi.fn();
    mocks.startAllAppSagas.mockReturnValue([stopOne, stopTwo]);
    const dispose = startAppStoreLifecycle(createStore([]));

    dispose();
    dispose();

    expect(mocks.stopRetentionFingerprint).toHaveBeenCalledOnce();
    expect(stopOne).toHaveBeenCalledOnce();
    expect(stopTwo).toHaveBeenCalledOnce();
  });

  it('replaces the previous saga owner across HMR generations', () => {
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    const hmrData: AppStoreHmrData = {};
    mocks.startAllAppSagas.mockReturnValueOnce([stopFirst]).mockReturnValueOnce([stopSecond]);

    const firstDispose = startAppStoreLifecycle(createStore([]), hmrData);
    const secondDispose = startAppStoreLifecycle(createStore([]), hmrData);

    expect(stopFirst).toHaveBeenCalledOnce();
    expect(mocks.stopRetentionFingerprint).toHaveBeenCalledOnce();
    firstDispose();
    expect(stopSecond).not.toHaveBeenCalled();
    secondDispose();
    secondDispose();
    expect(mocks.stopRetentionFingerprint).toHaveBeenCalledTimes(2);
    expect(stopSecond).toHaveBeenCalledOnce();
    expect(hmrData.appSagasStop).toBeUndefined();
  });
});
