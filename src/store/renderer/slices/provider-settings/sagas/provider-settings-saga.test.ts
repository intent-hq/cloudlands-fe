import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ update: vi.fn(), list: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { settings: { update: mocks.update, list: mocks.list } },
}));

import { BackendError } from '$lib/client/live/backend-transport-types';

import {
  enablementPersistRejected,
  setActiveProvider,
  setProviderEnabled,
  toggleProvider,
  initialState,
} from '../provider-settings-slice';
import { hydrateDefaultProvider, initialState as modelInitialState } from '../../model/model-slice';
import { settingsFieldsRefreshRequested } from '../../settings-events/settings-events-slice';
import { initialState as backgroundInitialState } from '../../background-agent-settings/background-agent-settings-slice';
import { PROVIDER_SETTINGS_RETRY_DELAYS_MS, providerSettingsSaga } from './provider-settings-saga';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function state(canBeDisabled = true) {
  return {
    backgroundAgentSettings: backgroundInitialState,
    model: modelInitialState,
    providerSettings: {
      ...initialState,
      activeProviderId: 'auggie',
      enabledProviders: { codex: true },
    },
    providerCatalog: {
      providers: createCollection('id', [{ id: 'codex', canBeDisabled }]),
    },
  };
}

describe('providerSettingsSaga', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.list.mockResolvedValue([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: {} },
      { path: 'quickActions.defaultModel', value: null },
      { path: 'quickActions.typeOverrides', value: {} },
      { path: 'quickActions.defaultReasoningEffort', value: null },
      { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
      { path: 'quickActions.providerSettings', value: {} },
    ]);
  });

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

  it('retains transport retry for enablement writes and drains that queue in order', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('settings unavailable')).mockResolvedValue([]);
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => state() },
        providerSettingsSaga,
      );

      channel.put(setProviderEnabled({ providerId: 'codex', enabled: false }));
      await vi.advanceTimersByTimeAsync(0);
      channel.put(toggleProvider('codex'));
      await vi.advanceTimersByTimeAsync(0);
      // Enablement retains its existing retry policy; model/provider defaults do not.
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'providers.enabled', value: { codex: false } }]],
      ]);

      await vi.advanceTimersByTimeAsync(PROVIDER_SETTINGS_RETRY_DELAYS_MS[0]);
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'providers.enabled', value: { codex: false } }]],
        [[{ path: 'providers.enabled', value: { codex: false } }]],
        [[{ path: 'providers.enabled', value: { codex: true } }]],
      ]);
      task.cancel();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
    new Error('settings unavailable'),
  ])(
    'requests field recovery rather than retrying a default-provider failure (%s)',
    async (error) => {
      mocks.update.mockRejectedValue(error);
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => state() }, providerSettingsSaga);

      channel.put(setActiveProvider('codex'));
      await settle();

      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.defaultProvider', value: 'codex' }]],
      ]);
      expect(mocks.list).toHaveBeenCalledExactlyOnceWith();
      expect(dispatch).toHaveBeenCalledWith(
        settingsFieldsRefreshRequested(['model.defaultProvider'], null),
      );
      task.cancel();
      await task.toPromise();
    },
  );

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
    expect(dispatch).toHaveBeenCalledWith(enablementPersistRejected('claude-code', 0));
    task.cancel();
    await task.toPromise();
  });
});
