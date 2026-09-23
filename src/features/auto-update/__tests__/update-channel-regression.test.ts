/**
 * Regression tests for intent-hq/monorepo#1672 at the IPC boundary.
 *
 * Runs the REAL configured store (full middleware chain) against the mock IPC
 * router and asserts, in order:
 *   1. Boot with main-process channel "beta" hydrates Redux
 *      `updateChannel` to 'beta' without any user action.
 *   2. Saga-owned hydration through the registered auto-update bridge produces
 *      ZERO `auto-update:set-channel` IPC calls — the original bug echoed
 *      hydration back into a channel write.
 *   3. A user channel change produces EXACTLY ONE `auto-update:set-channel`
 *      call with the requested channel.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock backend transport so unrelated Store initialization probes resolve quietly
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: 'sub-beta-reg-1' }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { AUTO_UPDATE_CHANNELS } from '$features/auto-update/types';
import { autoUpdateClient } from '$features/auto-update/auto-update.client';
import type { UpdateState } from '$features/auto-update/types';
import { store as appStore } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { updateChannelSaga } from '$store/renderer/slices/user-preferences/sagas/update-channel-saga';
import { setUpdateChannel } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import '$store/renderer/seeders';

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const setChannelSpy = vi.fn();
const mainProcessState: UpdateState = {
  status: 'idle',
  currentVersion: '2.19.0',
  updateInfo: null,
  progress: null,
  error: null,
  channel: 'beta',
};
const invokeSpy = vi.fn(async (channel: string, request?: unknown) => {
  if (channel === AUTO_UPDATE_CHANNELS.GET_STATE) {
    return { success: true, data: mainProcessState };
  }
  if (channel === AUTO_UPDATE_CHANNELS.SET_CHANNEL) {
    setChannelSpy(request);
    return { success: true };
  }
  throw new Error(`Unexpected Electron invoke: ${channel}`);
});

beforeAll(() => {
  (window as any).electronAPI = {
    ...((window as any).electronAPI || {}),
    invoke: invokeSpy,
  };
});

describe('update-channel regression (intent-hq/monorepo#1672)', () => {
  let disposeStore: (() => void) | undefined;

  beforeAll(async () => {
    disposeStore = startRootStoreLifecycle(appStore, {
      startSagas: (store) => [store.runSaga(updateChannelSaga)],
    });
    await flush();
  });

  afterAll(() => disposeStore?.());

  it('boot with main-process channel beta hydrates Redux updateChannel=beta without user action', async () => {
    await vi.waitFor(() => {
      expect(appStore.state.userPreferences?.updateChannel).toBe('beta');
    });
  });

  it('boot hydration produces zero set-channel IPC calls', async () => {
    await flush();
    expect(setChannelSpy).not.toHaveBeenCalled();
  });

  it('boot hydration performs exactly one protocol-shaped get-state request', () => {
    expect(
      invokeSpy.mock.calls.filter(([channel]) => channel === AUTO_UPDATE_CHANNELS.GET_STATE),
    ).toEqual([[AUTO_UPDATE_CHANNELS.GET_STATE, undefined]]);
  });

  it('a user switch to stable produces exactly one set-channel call with channel=stable', async () => {
    setChannelSpy.mockClear();

    appStore.dispatch(setUpdateChannel('stable'));
    await vi.waitFor(() => {
      expect(setChannelSpy).toHaveBeenCalledTimes(1);
    });
    expect(setChannelSpy).toHaveBeenCalledWith({ channel: 'stable' });

    // No delayed echo may follow the single persistence write
    await flush();
    expect(setChannelSpy).toHaveBeenCalledTimes(1);
  });

  it('a user switch to alpha produces exactly one set-channel call with channel=alpha', async () => {
    setChannelSpy.mockClear();

    appStore.dispatch(setUpdateChannel('alpha'));
    await vi.waitFor(() => {
      expect(setChannelSpy).toHaveBeenCalledTimes(1);
    });
    expect(setChannelSpy).toHaveBeenCalledWith({ channel: 'alpha' });

    await flush();
    expect(setChannelSpy).toHaveBeenCalledTimes(1);
  });

  it('a call site that direct-calls setChannel in addition to dispatching double-writes (why the single-writer guard exists)', async () => {
    setChannelSpy.mockClear();

    // Replays the pre-fix Settings-page handler sequence (await a direct
    // client setChannel, then dispatch) against the real Store lifecycle and
    // saga: it has no value-dedup and persists every observed
    // setUpdateChannel — so the direct call adds a second SET_CHANNEL
    // write. Dispatch-only call sites are therefore mandatory.
    await autoUpdateClient.setChannel('beta');
    appStore.dispatch(setUpdateChannel('beta'));

    await vi.waitFor(() => {
      expect(setChannelSpy).toHaveBeenCalledTimes(2);
    });
  });
});

// The single-writer call-site guard (the persistence saga is the ONLY renderer
// caller of autoUpdateClient.setChannel; Settings and settings proposals
// dispatch setUpdateChannel instead) is the `lint:update-channel-writer`
// architecture gate: scripts/check-update-channel-writer.mjs.
