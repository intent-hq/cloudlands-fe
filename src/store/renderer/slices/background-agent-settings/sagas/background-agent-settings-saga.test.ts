import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ update: vi.fn(), list: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { settings: { update: mocks.update, list: mocks.list } },
}));
import type { AppSettingChange } from '$lib/client/app-client';

import {
  hydrateSettings,
  setDefaultModel,
  setDefaultReasoningEffort,
  setTypeOverride,
  backgroundSettingsHydrationRequested,
  backgroundAgentSettingsReducer,
  initialState,
  BG_MODEL_MIGRATION_MARKER_KEY,
} from '../background-agent-settings-slice';
import { backgroundAgentSettingsSaga } from './background-agent-settings-saga';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

let persisted: Record<string, unknown>;
function commit(changes: AppSettingChange[]) {
  for (const { path, value } of changes) persisted[path] = structuredClone(value);
  return structuredClone(changes);
}

function harness() {
  let state = {
    backgroundAgentSettings: backgroundAgentSettingsReducer(
      initialState,
      hydrateSettings({
        providerId: 'codex',
        defaultModel: 'sonnet4.5',
        typeOverrides: { commit: '', pr: '', review: '', fast: '' },
        defaultReasoningEffort: '',
        typeReasoningEffortOverrides: {},
        providerSettings: {},
      }),
    ),
  };
  const channel = stdChannel();
  const dispatch = (action: Parameters<typeof backgroundAgentSettingsReducer>[1]) => {
    state = {
      backgroundAgentSettings: backgroundAgentSettingsReducer(
        state.backgroundAgentSettings,
        action,
      ),
    };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, backgroundAgentSettingsSaga);
  return { task, dispatch, state: () => state };
}

describe('backgroundAgentSettingsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persisted = {
      'model.defaultProvider': 'codex',
      'model.providerDefaults': {},
      'quickActions.defaultModel': 'sonnet4.5',
      'quickActions.typeOverrides': { commit: '', pr: '', review: '', fast: '' },
      'quickActions.defaultReasoningEffort': '',
      'quickActions.typeReasoningEffortOverrides': {},
      'quickActions.providerSettings': {},
    };
    mocks.list.mockImplementation(async () =>
      Object.entries(persisted).map(([path, value]) => ({ path, value: structuredClone(value) })),
    );
    mocks.update.mockImplementation(async (changes: AppSettingChange[]) => commit(changes));
  });

  it('orders migration behind an active user write without replacing a newer queued pick', async () => {
    let release!: () => void;
    let acceptMigration!: () => void;
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    mocks.update
      .mockImplementationOnce(async (changes: AppSettingChange[]) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return commit(changes);
      })
      .mockImplementationOnce(async (changes: AppSettingChange[]) => {
        await new Promise<void>((resolve) => {
          acceptMigration = resolve;
        });
        return commit(changes);
      });
    const { task, dispatch, state } = harness();
    dispatch(setDefaultModel('first'));
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    dispatch(setDefaultModel('newest'));
    persisted['quickActions.defaultModel'] = 'haiku4.5';
    dispatch(
      backgroundSettingsHydrationRequested({
        defaultModel: 'haiku4.5',
        typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      }),
    );
    // Replaces the migration trigger in the sliding buffer, but the eventual
    // complete snapshot still covers that migration generation.
    dispatch(setDefaultReasoningEffort('high'));
    expect(state().backgroundAgentSettings.defaultModel).toBe('newest');
    expect(state().backgroundAgentSettings.defaultReasoningEffort).toBe('high');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).not.toHaveBeenCalledWith(BG_MODEL_MIGRATION_MARKER_KEY, '1');
    release();
    await settle();
    expect(
      mocks.update.mock.calls.map(([changes]) =>
        changes.find(({ path }: AppSettingChange) => path === 'quickActions.defaultModel'),
      ),
    ).toEqual([
      { path: 'quickActions.defaultModel', value: 'first' },
      { path: 'quickActions.defaultModel', value: 'newest' },
    ]);
    expect(mocks.update.mock.calls[1][0]).toContainEqual({
      path: 'quickActions.defaultReasoningEffort',
      value: 'high',
    });
    // The earlier write's acknowledgement cannot commit the migration marker.
    expect(localStorage.setItem).not.toHaveBeenCalledWith(BG_MODEL_MIGRATION_MARKER_KEY, '1');
    acceptMigration();
    await settle();
    expect(localStorage.setItem).toHaveBeenCalledWith(BG_MODEL_MIGRATION_MARKER_KEY, '1');
    expect(mocks.list.mock.calls).toEqual([[], []]);
    task.cancel();
    await task.toPromise();
  });

  it('does not commit a pending migration after the saga owner is cancelled', async () => {
    let release!: () => void;
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    mocks.update.mockImplementationOnce(async (changes: AppSettingChange[]) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return commit(changes);
    });
    const { task, dispatch } = harness();
    persisted['quickActions.defaultModel'] = 'haiku4.5';
    dispatch(
      backgroundSettingsHydrationRequested({
        defaultModel: 'haiku4.5',
        typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      }),
    );
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    task.cancel();
    await task.toPromise();
    release();
    await settle();
    expect(localStorage.setItem).not.toHaveBeenCalledWith(BG_MODEL_MIGRATION_MARKER_KEY, '1');
    expect(mocks.list.mock.calls).toEqual([[]]);
  });

  it('atomically serializes current snapshots and retains only the latest queued write', async () => {
    let release!: () => void;
    mocks.update.mockImplementationOnce(async (changes: AppSettingChange[]) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return commit(changes);
    });
    const { task, dispatch, state } = harness();
    dispatch(setDefaultModel('opus4.7'));
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    dispatch(setTypeOverride({ type: 'commit', model: 'haiku4.5' }));
    dispatch(setTypeOverride({ type: 'fast', model: 'gpt-5' }));
    release();
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [
        [
          { path: 'model.defaultProvider', value: 'codex' },
          { path: 'quickActions.defaultModel', value: 'opus4.7' },
          {
            path: 'quickActions.typeOverrides',
            value: { commit: '', pr: '', review: '', fast: '' },
          },
          { path: 'quickActions.defaultReasoningEffort', value: '' },
          { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
          { path: 'quickActions.providerSettings', value: {} },
        ],
      ],
      [
        [
          { path: 'model.defaultProvider', value: 'codex' },
          { path: 'quickActions.defaultModel', value: 'opus4.7' },
          {
            path: 'quickActions.typeOverrides',
            value: { commit: 'haiku4.5', pr: '', review: '', fast: 'gpt-5' },
          },
          { path: 'quickActions.defaultReasoningEffort', value: '' },
          { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
          { path: 'quickActions.providerSettings', value: {} },
        ],
      ],
    ]);
    expect(mocks.list.mock.calls).toEqual([[], []]);
    expect(state().backgroundAgentSettings.persistencePending).toBe(false);
    expect(persisted['quickActions.defaultModel']).toBe('opus4.7');
    task.cancel();
    await task.toPromise();
  });

  it('does not echo hydration snapshots back to settings.update', async () => {
    const { task, dispatch } = harness();
    persisted['quickActions.defaultModel'] = 'hydrated';
    dispatch(
      hydrateSettings({
        defaultModel: 'hydrated',
        typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      }),
    );
    await settle();

    expect(mocks.update.mock.calls).toEqual([]);
    expect(mocks.list).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });
});
