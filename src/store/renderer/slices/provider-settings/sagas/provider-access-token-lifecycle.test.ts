import { afterEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), reset: vi.fn(), list: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: mocks } }));
import { providerSettingsSaga } from '$store/renderer/slices/provider-settings/sagas/provider-settings-saga';
import {
  initialState,
  providerSettingsReducer,
  providerSettingsSessionOpened,
  providerTokenReadRequested,
  providerTokenWriteRequested,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { initialState as backgroundInitialState } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import { initialState as modelInitialState } from '$store/renderer/slices/model/model-slice';
import { initialState as availabilityInitialState } from '$store/renderer/slices/agent-availability/agent-availability-slice';
import {
  stageProviderToken,
  clearProviderTokenDrafts,
} from '$features/settings/provider-token-drafts';
const tasks: Task[] = [];
afterEach(() => {
  tasks.forEach((task) => task.cancel());
  clearProviderTokenDrafts();
});
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
it('allows token reads again after the settings owner cancels a pending save and restarts', async () => {
  const path = 'providers.codex.accessToken';
  mocks.get.mockResolvedValue({ path, sensitive: true, value: null });
  mocks.list.mockResolvedValue([]);
  let finish!: (value: unknown) => void;
  mocks.update.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let state = {
    providerSettings: {
      ...initialState,
      profiles: { ...initialState.profiles, revision: 7 },
    },
    backgroundAgentSettings: backgroundInitialState,
    model: modelInitialState,
    agentAvailability: availabilityInitialState,
    providerCatalog: {
      providers: createCollection('id', [
        { id: 'codex', accessToken: { kind: 'codexAccessToken', settingPath: path } },
      ]),
    },
  };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const context = {
    reduxStore: {
      getState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  const actions: any[] = [];
  const dispatch = (action: any) => {
    actions.push(action);
    state = { ...state, providerSettings: providerSettingsReducer(state.providerSettings, action) };
    for (const listener of listeners) listener();
    channel.put(action);
  };
  const start = () => {
    const task = runSaga(
      { channel, dispatch, getState: () => state, context },
      providerSettingsSaga,
    );
    tasks.push(task);
    return task;
  };
  const profilesBefore = state.providerSettings.profiles;
  const first = start();
  dispatch(providerSettingsSessionOpened('review'));
  dispatch(providerTokenReadRequested('codex'));
  await settle();
  expect(state.providerSettings.accessTokens.codex).toMatchObject({
    status: 'ready',
    configured: false,
    busy: false,
  });
  stageProviderToken('save', 'review', 'synthetic-stop-lifecycle');
  dispatch(providerTokenWriteRequested('codex', 'save', { id: 'save', sessionId: 'review' }));
  await settle();
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(state.providerSettings.accessTokens.codex.busy).toBe(true);
  first.cancel();
  await first.toPromise();
  expect(actions.some((action) => action.type === 'providerSettings/stopped')).toBe(true);
  finish([{ path, value: '********' }]);
  await settle();
  expect.soft(state.providerSettings.accessTokens).toEqual({});
  expect(state.providerSettings.profiles).toBe(profilesBefore);
  start();
  dispatch(providerTokenReadRequested('codex'));
  await settle();
  expect.soft(mocks.get).toHaveBeenCalledTimes(2);
  expect
    .soft(state.providerSettings.accessTokens.codex)
    .toMatchObject({ status: 'ready', configured: false, busy: false });
  expect(JSON.stringify([state, actions])).not.toContain('synthetic-stop-lifecycle');
});
