import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';

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

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function harness() {
  const disposeStore = store.init();
  const runtimeErrors: unknown[] = [];
  const recordRuntimeError = (event: unknown) => runtimeErrors.push(event);
  store.traceStreams.runtimeError.onValue(recordRuntimeError);
  const cancelOwners: (() => void)[] = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const cancel of [...cancelOwners].reverse()) cancel();
    await settle();
  };
  cleanups.push(async () => {
    try {
      await stop();
    } finally {
      disposeStore();
      store.traceStreams.runtimeError.offValue(recordRuntimeError);
    }
    expect(runtimeErrors).toEqual([]);
  });
  admitLegacyPrincipal();
  const connection = selectPrincipalConnectionContext.select(store.state);
  if (!connection) throw new Error('Settings test requires an admitted connection');
  store.dispatch(hostExecutionConnectionChanged(connection));
  store.dispatch(
    hydrateSettings({
      providerId: 'codex',
      defaultModel: 'sonnet4.5',
      typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      defaultReasoningEffort: '',
      typeReasoningEffortOverrides: {},
      providerSettings: {},
    }),
  );
  cancelOwners.push(store.runSaga(backgroundAgentSettingsSaga));
  return { stop, dispatch: store.dispatch, state: () => store.state };
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
    const { stop, dispatch, state } = harness();
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
    await stop();
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
    const { stop, dispatch } = harness();
    persisted['quickActions.defaultModel'] = 'haiku4.5';
    dispatch(
      backgroundSettingsHydrationRequested({
        defaultModel: 'haiku4.5',
        typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      }),
    );
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    await stop();
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
    const { stop, dispatch, state } = harness();
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
    await stop();
  });

  it('does not echo hydration snapshots back to settings.update', async () => {
    const { stop, dispatch } = harness();
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
    await stop();
  });
});
