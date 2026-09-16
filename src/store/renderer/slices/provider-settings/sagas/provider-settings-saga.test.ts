import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
  invoke: vi.fn(),
  checkPiMcpAdapterInstalled: vi.fn(),
  installPiMcpAdapter: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { update: mocks.update, get: mocks.get } },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$features/pi/pi-models.client', () => ({
  checkPiMcpAdapterInstalled: mocks.checkPiMcpAdapterInstalled,
  installPiMcpAdapter: mocks.installPiMcpAdapter,
}));
vi.mock('svelte-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { BackendError } from '$lib/client/live/backend-transport-types';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';

import {
  activeProviderPersistRejected,
  checkPiMcpAdapterRequested,
  enablementPersistRejected,
  installPiMcpAdapterRequested,
  loadProviderPathsRequested,
  providerPathSaved,
  saveProviderPathRequested,
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

  it('loads configured and discovered provider paths through saga-owned seams', async () => {
    mocks.get.mockResolvedValue({ value: { codex: '/custom/codex', invalid: 7 } });
    mocks.invoke.mockResolvedValue({
      success: true,
      data: {
        paths: { codex: '/usr/bin/codex', pi: null },
        secondaryPaths: { unsloth: '/usr/bin/unsloth' },
      },
    });
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => state() }, providerSettingsSaga);

    channel.put(loadProviderPathsRequested());
    await settle();

    expect(mocks.get).toHaveBeenCalledWith('providers.paths');
    expect(mocks.invoke).toHaveBeenCalledWith(PROVIDERS_CHANNELS.GET_PATHS);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'providerSettings/providerPathsLoaded',
      payload: [
        { codex: '/custom/codex' },
        { codex: '/usr/bin/codex' },
        { unsloth: '/usr/bin/unsloth' },
      ],
    });
    task.cancel();
    await task.toPromise();
  });

  it('serializes overlapping path saves so full-map writes preserve earlier providers', async () => {
    let releaseFirst!: (value: unknown) => void;
    mocks.get
      .mockResolvedValueOnce({ value: {} })
      .mockResolvedValueOnce({ value: { codex: '/first/codex' } });
    mocks.update
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([]);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => state() }, providerSettingsSaga);

    channel.put(saveProviderPathRequested('codex', '/first/codex', 'save-1'));
    await settle();
    channel.put(saveProviderPathRequested('claude-code', '/second/claude', 'save-2'));
    await settle();

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'providers.paths', value: { codex: '/first/codex' } }]],
    ]);

    releaseFirst([]);
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.get).toHaveBeenNthCalledWith(2, 'providers.paths');
    expect(mocks.update.mock.calls[1]).toEqual([
      [
        {
          path: 'providers.paths',
          value: { codex: '/first/codex', 'claude-code': '/second/claude' },
        },
      ],
    ]);
    expect(dispatch).toHaveBeenCalledWith(
      providerPathSaved('claude-code', '/second/claude', 'save-2'),
    );
    task.cancel();
    await task.toPromise();
  });

  it('checks and installs the Pi adapter outside the component', async () => {
    mocks.checkPiMcpAdapterInstalled.mockResolvedValue(false);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => state() }, providerSettingsSaga);
    channel.put(checkPiMcpAdapterRequested());
    await settle();
    expect(dispatch).toHaveBeenCalledWith({
      type: 'providerSettings/piMcpAdapterStatusLoaded',
      payload: [false],
    });

    mocks.installPiMcpAdapter.mockResolvedValue({ success: true });
    mocks.checkPiMcpAdapterInstalled.mockResolvedValue(true);
    channel.put(installPiMcpAdapterRequested());
    await settle();
    await settle();

    expect(mocks.installPiMcpAdapter).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      type: 'providerSettings/piMcpAdapterStatusLoaded',
      payload: [true],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'providerSettings/piMcpAdapterInstallComplete',
      payload: [],
    });
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    task.cancel();
    await task.toPromise();
  });
});
