import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { update: mocks.update } } }));

import { BackendError } from '$lib/client/live/backend-transport-types';

import {
  activeProviderPersistRejected,
  enablementPersistRejected,
  setActiveProvider,
  setProviderEnabled,
  toggleProvider,
} from '../provider-settings-slice';
import { hydrateDefaultProvider } from '../../model/model-slice';
import { PROVIDER_SETTINGS_RETRY_DELAYS_MS, providerSettingsSaga } from './provider-settings-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state(canBeDisabled = true) {
  return {
    providerSettings: {
      activeProviderId: 'auggie',
      enabledProviders: { codex: true },
    },
    providerCatalog: {
      providers: createCollection('id', [{ id: 'codex', canBeDisabled }]),
    },
  };
}

describe('providerSettingsSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serializes partial active and enabled writes with exact post-state payloads', async () => {
    let release!: (value: unknown) => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const current = state();
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => current },
      providerSettingsSaga,
    );
    channel.put(setActiveProvider('codex'));
    await settle();
    channel.put(toggleProvider('codex'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultProvider', value: 'codex' }]],
    ]);
    release([]);
    await settle();
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultProvider', value: 'codex' }]],
      [[{ path: 'providers.enabled', value: { codex: true } }]],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('skips enabled persistence when the catalog says the reducer mutation is a no-op', async () => {
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => state(false) },
      providerSettingsSaga,
    );
    channel.put(toggleProvider('codex'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('merges the click intent over the live map at write time after hydration replaced it (monorepo#1986)', async () => {
    let release!: (value: unknown) => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const current = state();
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => current },
      providerSettingsSaga,
    );
    channel.put(setActiveProvider('codex'));
    await settle();
    channel.put(setProviderEnabled({ providerId: 'claude-code', enabled: true }));
    await settle();
    // Boot settings hydration replaces the whole local map while the write is
    // still queued behind the in-flight active-provider write — the stale
    // snapshot has no claude-code entry.
    current.providerSettings.enabledProviders = { auggie: true };
    release([]);
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultProvider', value: 'codex' }]],
      [[{ path: 'providers.enabled', value: { auggie: true, 'claude-code': true } }]],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not echo provider hydration actions', async () => {
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: state }, providerSettingsSaga);
    channel.put(hydrateDefaultProvider('codex'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('retries a transport-rejected write until it lands, then drains the queue in order', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('settings unavailable')).mockResolvedValue([]);
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => state() },
        providerSettingsSaga,
      );

      channel.put(setActiveProvider('codex'));
      await vi.advanceTimersByTimeAsync(0);
      channel.put(toggleProvider('codex'));
      await vi.advanceTimersByTimeAsync(0);
      // The failed active-provider write is retried before the queued
      // enabled-providers write — order is preserved.
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.defaultProvider', value: 'codex' }]],
      ]);

      await vi.advanceTimersByTimeAsync(PROVIDER_SETTINGS_RETRY_DELAYS_MS[0]);
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.defaultProvider', value: 'codex' }]],
        [[{ path: 'model.defaultProvider', value: 'codex' }]],
        [[{ path: 'providers.enabled', value: { codex: true } }]],
      ]);
      task.cancel();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a structured daemon error response', async () => {
    mocks.update.mockRejectedValue(
      new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
    );
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => state() }, providerSettingsSaga);

    channel.put(setActiveProvider('codex'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultProvider', value: 'codex' }]],
    ]);
    expect(dispatch).toHaveBeenCalledWith(activeProviderPersistRejected('codex'));
    task.cancel();
    await task.toPromise();
  });

  it('retires the pending override when the daemon rejects an enablement write (monorepo#1986)', async () => {
    mocks.update.mockRejectedValue(
      new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
    );
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => state() }, providerSettingsSaga);

    channel.put(setProviderEnabled({ providerId: 'claude-code', enabled: true }));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'providers.enabled', value: { codex: true, 'claude-code': true } }]],
    ]);
    expect(dispatch).toHaveBeenCalledWith(enablementPersistRejected('claude-code'));
    task.cancel();
    await task.toPromise();
  });
});
