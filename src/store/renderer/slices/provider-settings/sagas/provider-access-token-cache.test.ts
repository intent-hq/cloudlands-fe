import { afterEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { BackendNotification } from '$lib/client/live/backend-transport';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
const wire = vi.hoisted(() => ({
  request: vi.fn(),
  notifications: [] as Array<(n: BackendNotification) => void>,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  onBackendNotification: (handler: (n: BackendNotification) => void) => {
    wire.notifications.push(handler);
    return () => {};
  },
  onBackendReconnected: () => () => {},
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});
import { providerAccessTokenSaga } from '$store/renderer/slices/provider-settings/sagas/provider-access-token-saga';
import {
  initialState,
  providerSettingsReducer,
  providerSettingsSessionOpened,
  providerTokenReadRequested,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { settingsChangesReceived } from '$store/renderer/slices/settings-events/settings-events-slice';
const path = 'providers.codex.accessToken';
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
let task: Task | undefined;
afterEach(() => {
  task?.cancel();
  __resetSettingsReadCacheForTests();
});
it('refreshes a token after a remote reset with production listener order and real settings cache', async () => {
  let saved = true;
  wire.request.mockImplementation(async (method: string) => {
    if (method !== 'settings.get') throw new Error('unexpected method');
    return {
      definition: { path, sensitive: true, type: 'string' },
      value: saved ? '********' : null,
    };
  });
  let state = {
    providerSettings: initialState,
    providerCatalog: {
      providers: createCollection('id', [
        {
          id: 'codex',
          accessToken: { kind: 'codexAccessToken', settingPath: path },
        },
      ]),
    },
  };
  const channel = stdChannel();
  const dispatch = (action: any) => {
    state = { ...state, providerSettings: providerSettingsReducer(state.providerSettings, action) };
    channel.put(action);
  };
  // daemonEventsSaga is registered before settingsHydrationSaga/providerSettingsSaga.
  // Its routeDaemonEventsNotification + settingsChangesReceived path is synchronous.
  wire.notifications.push((n) => {
    const params = n.params as {
      event: { data: { changes: { path: string; value: null | string }[]; revision: number } };
    };
    dispatch(settingsChangesReceived(params.event.data.changes, params.event.data.revision));
  });
  task = runSaga({ channel, dispatch, getState: () => state }, providerAccessTokenSaga);
  dispatch(providerSettingsSessionOpened('review'));
  dispatch(providerTokenReadRequested('codex'));
  await settle();
  expect(state.providerSettings.accessTokens.codex.configured).toBe(true);
  expect(wire.request).toHaveBeenCalledTimes(1);
  expect(wire.notifications).toHaveLength(2);
  saved = false;
  const notification = {
    method: 'events.event',
    params: {
      event: {
        type: 'settings:changed',
        data: { changes: [{ path, value: null }], revision: 2 },
      },
    },
  };
  for (const handler of [...wire.notifications]) handler(notification);
  await settle();
  expect(state.providerSettings.accessTokens.codex.configured).toBe(false);
  expect(wire.request).toHaveBeenCalledTimes(2);

  // Every notification must invalidate before dispatch, but overlapping reads
  // still share the settings client's pending read plus at most one trailing read.
  saved = true;
  for (let revision = 3; revision < 23; revision++) {
    const changed = {
      method: 'events.event',
      params: {
        event: {
          type: 'settings:changed',
          data: { changes: [{ path, value: '********' }], revision },
        },
      },
    };
    for (const handler of [...wire.notifications]) handler(changed);
  }
  await settle();
  expect(state.providerSettings.accessTokens.codex.configured).toBe(true);
  expect(wire.request).toHaveBeenCalledTimes(4);
});
