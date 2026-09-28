import { afterEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import type { AppSettingChange } from '$lib/client/app-client';
import { store } from '../../store';
import { settingsHydrationSaga } from '../settings-events/sagas/settings-hydration-saga';
import { settingsChangesReceived } from '../settings-events/settings-events-slice';
import { providerSettingsSaga } from '../provider-settings/sagas/provider-settings-saga';
import { modelSelectionSaga } from '../model/sagas/model-selection-saga';
import { backgroundAgentSettingsSaga } from './sagas/background-agent-settings-saga';
import {
  setActiveProvider,
  setAtomicDefaultModel,
} from '../provider-settings/provider-settings-slice';
import {
  setDefaultReasoningEffort,
  setTypeReasoningEffortOverride,
} from './background-agent-settings-slice';

const request = vi.mocked(backendRequest);
const tasks: Task[] = [];
let dispose: (() => void) | undefined;
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  dispose?.();
  vi.resetAllMocks();
});
const emptyModels = { commit: '', pr: '', review: '', fast: '' };
const initial: AppSettingChange[] = [
  { path: 'model.defaultProvider', value: 'codex' },
  { path: 'quickActions.defaultModel', value: 'balanced' },
  { path: 'quickActions.typeOverrides', value: emptyModels },
  { path: 'quickActions.defaultReasoningEffort', value: 'medium' },
  { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
  {
    path: 'quickActions.providerSettings',
    value: {
      legacy: { defaultModel: 'basic', typeOverrides: emptyModels },
      other: {
        defaultModel: 'other-model',
        typeOverrides: emptyModels,
        defaultReasoningEffort: 'low',
      },
    },
  },
];
function start() {
  dispose = store.init();
  const channel = stdChannel();
  const dispatch = (action: { type: string }) => {
    store.dispatch(action);
    channel.put(action);
    return action;
  };
  const environment = { channel, dispatch, getState: () => store.state };
  for (const saga of [
    settingsHydrationSaga,
    providerSettingsSaga,
    modelSelectionSaga,
    backgroundAgentSettingsSaga,
  ])
    tasks.push(runSaga(environment, saga));
  return dispatch;
}

for (const atomic of [false, true]) {
  for (const perAction of [false, true]) {
    it(`keeps provider ownership with partial acknowledgements and late events (atomic ${atomic}, action effort ${perAction})`, async () => {
      const persisted = Object.fromEntries(
        initial.map(({ path, value }) => [path, structuredClone(value)]),
      );
      let revision = 1;
      const writes: AppSettingChange[][] = [];
      let release!: () => void;
      let firstApplied: AppSettingChange[] = [];
      request.mockImplementation(async (method, params) => {
        if (method === 'settings.list') return { settings: initial, revision: 1 };
        const changes = (params as { changes: AppSettingChange[] }).changes;
        writes.push(changes);
        const applied = changes.filter(
          ({ path, value }) => JSON.stringify(persisted[path]) !== JSON.stringify(value),
        );
        if (writes.length === 1) {
          firstApplied = applied;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        for (const { path, value } of changes) persisted[path] = structuredClone(value);
        return { applied, revision: ++revision };
      });
      const dispatch = start();
      await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
      const choose = (effort: string) =>
        perAction
          ? setTypeReasoningEffortOverride({ type: 'fast', effort })
          : setDefaultReasoningEffort(effort);
      dispatch(choose('low'));
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      dispatch(choose('high'));
      dispatch(
        atomic
          ? setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' })
          : setActiveProvider('legacy'),
      );
      expect(writes).toHaveLength(1);
      // Daemon deltas omit the unchanged provider even though the request includes it.
      expect(firstApplied.map(({ path }) => path)).toEqual([
        perAction
          ? 'quickActions.typeReasoningEffortOverrides'
          : 'quickActions.defaultReasoningEffort',
      ]);
      dispatch(settingsChangesReceived(firstApplied, 2));
      expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('');
      expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual({});
      release();
      await vi.waitFor(() => expect(writes).toHaveLength(3));
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
      );
      expect(persisted['model.defaultProvider']).toBe('legacy');
      expect(persisted['quickActions.defaultReasoningEffort']).toBe('');
      expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({});
      // The full request is acknowledged even when the final save applied no changes.
      dispatch(settingsChangesReceived(firstApplied, 2));
      expect(store.state.backgroundAgentSettings.providerId).toBe('legacy');
      expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('');
      expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual({});
      dispatch(
        atomic
          ? setAtomicDefaultModel({ providerId: 'codex', model: 'balanced' })
          : setActiveProvider('codex'),
      );
      await vi.waitFor(() => expect(writes).toHaveLength(4));
      expect(
        perAction
          ? store.state.backgroundAgentSettings.typeReasoningEffortOverrides.fast
          : store.state.backgroundAgentSettings.defaultReasoningEffort,
      ).toBe('high');
      expect(
        store.state.backgroundAgentSettings.providerSettings.other.defaultReasoningEffort,
      ).toBe('low');
      // A genuinely newer external change still hydrates after local saves settle.
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
      );
      dispatch(
        settingsChangesReceived(
          [{ path: 'quickActions.defaultReasoningEffort', value: 'remote' }],
          ++revision,
        ),
      );
      expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('remote');
    });
  }
}

it('releases pending intent and the write lock after a rejected effort save', async () => {
  request.mockImplementation(async (method) => {
    if (method === 'settings.list') return { settings: initial, revision: 1 };
    throw { code: -32602, message: 'rejected' };
  });
  const dispatch = start();
  await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
  dispatch(setDefaultReasoningEffort('high'));
  await vi.waitFor(() =>
    expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
  );
  dispatch(
    settingsChangesReceived([{ path: 'quickActions.defaultReasoningEffort', value: 'low' }], 2),
  );
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('low');
  request.mockResolvedValue({ applied: [], revision: 3 });
  dispatch(setActiveProvider('legacy'));
  await vi.waitFor(() =>
    expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
  );
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('');
});

it.each([false, true])(
  'does not let queued switches overtake the latest choice through another control (atomic first %s)',
  async (atomicFirst) => {
    const persisted = Object.fromEntries(
      initial.map(({ path, value }) => [path, structuredClone(value)]),
    );
    let release!: () => void;
    let updates = 0;
    let revision = 1;
    request.mockImplementation(async (method, params) => {
      if (method === 'settings.list') return { settings: initial, revision: 1 };
      const changes = (params as { changes: AppSettingChange[] }).changes;
      updates += 1;
      if (updates === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const applied = changes.filter(
        ({ path, value }) => JSON.stringify(persisted[path]) !== JSON.stringify(value),
      );
      for (const { path, value } of changes) persisted[path] = structuredClone(value);
      return { applied, revision: ++revision };
    });
    const dispatch = start();
    await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
    dispatch(setDefaultReasoningEffort('high'));
    await vi.waitFor(() => expect(updates).toBe(1));
    dispatch(
      atomicFirst
        ? setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' })
        : setActiveProvider('legacy'),
    );
    dispatch(
      atomicFirst
        ? setAtomicDefaultModel({ providerId: 'other', model: 'other-model' })
        : setActiveProvider('other'),
    );
    dispatch(
      atomicFirst
        ? setActiveProvider('codex')
        : setAtomicDefaultModel({ providerId: 'codex', model: 'balanced' }),
    );
    release();
    await vi.waitFor(() =>
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
    );
    // Drain the remaining queued writer before checking the authoritative daemon state.
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    expect(persisted['model.defaultProvider']).toBe('codex');
    expect(persisted['quickActions.defaultReasoningEffort']).toBe('high');
    expect(store.state.backgroundAgentSettings.providerId).toBe('codex');
  },
);
