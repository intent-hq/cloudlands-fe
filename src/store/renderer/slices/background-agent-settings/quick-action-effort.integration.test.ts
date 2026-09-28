import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { update } } }));
import { store } from '../../store';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { providerSettingsSaga } from '../provider-settings/sagas/provider-settings-saga';
import { modelSelectionSaga } from '../model/sagas/model-selection-saga';
import { backgroundAgentSettingsSaga } from './sagas/background-agent-settings-saga';
import {
  setActiveProvider,
  setAtomicDefaultModel,
} from '../provider-settings/provider-settings-slice';
import {
  setDefaultModel,
  setDefaultReasoningEffort,
  setTypeReasoningEffortOverride,
  resetSettings,
} from './background-agent-settings-slice';

let dispose: (() => void) | undefined;
const tasks: Task[] = [];
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  dispose?.();
  vi.resetAllMocks();
});
const emptyModels = { commit: '', pr: '', review: '', fast: '' };
const saved = {
  'model.defaultProvider': 'codex',
  'quickActions.defaultModel': 'codex:balanced',
  'quickActions.typeOverrides': emptyModels,
  'quickActions.defaultReasoningEffort': 'medium',
  'quickActions.typeReasoningEffortOverrides': { commit: 'high', review: 'low' },
  'quickActions.providerSettings': {
    legacy: { defaultModel: 'legacy:basic', typeOverrides: emptyModels },
  },
};
function setup() {
  dispose = store.init();
  applySettingsChanges(Object.entries(saved).map(([path, value]) => ({ path, value })));
  const persisted: Record<string, unknown> = structuredClone(saved);
  update.mockImplementation(async (changes: { path: string; value: unknown }[]) => {
    for (const { path, value } of changes) persisted[path] = structuredClone(value);
    return changes;
  });
  const channel = stdChannel();
  const dispatch = (action: { type: string }) => {
    store.dispatch(action);
    channel.put(action);
  };
  for (const saga of [providerSettingsSaga, modelSelectionSaga, backgroundAgentSettingsSaga]) {
    tasks.push(runSaga({ channel, dispatch, getState: () => store.state }, saga));
  }
  return { dispatch, persisted };
}

for (const atomic of [false, true]) {
  it(`persists and restores provider-local model and effort in one batch (model switch ${atomic})`, async () => {
    const { dispatch, persisted } = setup();
    dispatch(
      atomic
        ? setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' })
        : setActiveProvider('legacy'),
    );
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const changes = update.mock.calls[0][0];
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: 'model.defaultProvider', value: 'legacy' },
        { path: 'quickActions.defaultModel', value: 'legacy:basic' },
        { path: 'quickActions.defaultReasoningEffort', value: '' },
        { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
        {
          path: 'quickActions.providerSettings',
          value: {
            legacy: saved['quickActions.providerSettings'].legacy,
            codex: {
              defaultModel: 'codex:balanced',
              typeOverrides: emptyModels,
              defaultReasoningEffort: 'medium',
              typeReasoningEffortOverrides: { commit: 'high', review: 'low' },
            },
          },
        },
      ]),
    );
    if (atomic)
      expect(changes).toContainEqual({
        path: 'model.providerDefaults',
        value: { legacy: 'basic' },
      });
    expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('');
    expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual({});
    dispatch(setDefaultReasoningEffort('low'));
    await vi.waitFor(() => expect(persisted['quickActions.defaultReasoningEffort']).toBe('low'));
    dispatch(
      atomic
        ? setAtomicDefaultModel({ providerId: 'codex', model: 'balanced' })
        : setActiveProvider('codex'),
    );
    await vi.waitFor(() => expect(persisted['model.defaultProvider']).toBe('codex'));
    expect(persisted['quickActions.defaultReasoningEffort']).toBe('medium');
    expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({
      commit: 'high',
      review: 'low',
    });
    // Reload the daemon's saved snapshot, not the outgoing provider's UI state.
    const reloaded = structuredClone(persisted);
    dispatch(resetSettings());
    applySettingsChanges(Object.entries(reloaded).map(([path, value]) => ({ path, value })));
    expect(store.state.backgroundAgentSettings.defaultModel).toBe('codex:balanced');
    expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('medium');
  });
}

it('ignores a delayed provider-switch bundle after a newer provider choice', async () => {
  const { dispatch } = setup();
  dispatch(setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  const oldAcknowledgement = structuredClone(update.mock.calls[0][0]);
  dispatch(setAtomicDefaultModel({ providerId: 'codex', model: 'balanced' }));
  applySettingsChanges(oldAcknowledgement);
  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(store.state.backgroundAgentSettings.providerId).toBe('codex');
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('medium');
  expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual({
    commit: 'high',
    review: 'low',
  });
});

describe('partial settings and resets', () => {
  it('hydrates effort-only deltas and null clearing without dropping models or snapshots', () => {
    setup();
    applySettingsChanges([
      { path: 'quickActions.typeReasoningEffortOverrides', value: { fast: 'high' } },
    ]);
    expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual({
      fast: 'high',
    });
    expect(store.state.backgroundAgentSettings.defaultModel).toBe('codex:balanced');
    applySettingsChanges([{ path: 'quickActions.defaultReasoningEffort', value: null }]);
    expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('');
    expect(store.state.backgroundAgentSettings.providerSettings.legacy).toEqual(
      saved['quickActions.providerSettings'].legacy,
    );
  });
  it('persists unsupported saved candidates unchanged and globally resets all effort and snapshots', async () => {
    const { dispatch, persisted } = setup();
    dispatch(setTypeReasoningEffortOverride({ type: 'fast', effort: 'future-level' }));
    await vi.waitFor(() =>
      expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({
        commit: 'high',
        review: 'low',
        fast: 'future-level',
      }),
    );
    dispatch(setDefaultModel('model-without-effort'));
    await vi.waitFor(() =>
      expect(persisted['quickActions.defaultModel']).toBe('model-without-effort'),
    );
    expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({
      commit: 'high',
      review: 'low',
      fast: 'future-level',
    });
    dispatch(resetSettings());
    await vi.waitFor(() => expect(persisted['quickActions.defaultModel']).toBe(''));
    expect(persisted['quickActions.defaultReasoningEffort']).toBe('');
    expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({});
    expect(persisted['quickActions.providerSettings']).toEqual({});
  });
});
