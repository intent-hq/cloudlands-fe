import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ setProviderSettings: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { settings: { setProviderSettings: mocks.setProviderSettings } },
}));

import {
  hydrateActiveProvider,
  setActiveProvider,
  toggleProvider,
} from '../provider-settings-slice';
import { providerSettingsSaga } from './provider-settings-saga';

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
    let release!: (value: { success: boolean }) => void;
    mocks.setProviderSettings
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue({ success: true });
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

    expect(mocks.setProviderSettings.mock.calls).toEqual([[{ activeProviderId: 'codex' }]]);
    release({ success: true });
    await settle();
    expect(mocks.setProviderSettings.mock.calls).toEqual([
      [{ activeProviderId: 'codex' }],
      [{ enabledProviders: { codex: true } }],
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

    expect(mocks.setProviderSettings.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('does not echo provider hydration actions', async () => {
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: state }, providerSettingsSaga);
    channel.put(hydrateActiveProvider('codex'));
    await settle();

    expect(mocks.setProviderSettings.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('continues the serialized queue after a persistence rejection', async () => {
    mocks.setProviderSettings
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValueOnce({ success: true });
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => state() },
      providerSettingsSaga,
    );

    channel.put(setActiveProvider('codex'));
    await settle();
    channel.put(toggleProvider('codex'));
    await settle();

    expect(mocks.setProviderSettings.mock.calls).toEqual([
      [{ activeProviderId: 'codex' }],
      [{ enabledProviders: { codex: true } }],
    ]);
    task.cancel();
    await task.toPromise();
  });
});
