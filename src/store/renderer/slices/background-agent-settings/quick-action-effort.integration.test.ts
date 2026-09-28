import { afterEach, describe, expect, it, vi } from 'vitest';

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
  setTypeReasoningEffortOverrides,
  resetSettings,
} from './background-agent-settings-slice';

let dispose: (() => void) | undefined;
const stopSagas: (() => void)[] = [];
afterEach(async () => {
  for (const stop of stopSagas.splice(0)) stop();
  dispose?.();
  vi.resetAllMocks();
});
const emptyModels = { commit: '', pr: '', review: '', fast: '' };
const saved = {
  'model.defaultProvider': 'codex',
  'quickActions.defaultModel': 'balanced',
  'quickActions.typeOverrides': emptyModels,
  'quickActions.defaultReasoningEffort': 'medium',
  'quickActions.typeReasoningEffortOverrides': { commit: 'high', review: 'low' },
  'quickActions.providerSettings': {
    legacy: { defaultModel: 'basic', typeOverrides: emptyModels },
  },
};
function setup() {
  dispose = store.init();
  const persisted: Record<string, unknown> = structuredClone(saved);
  update.mockImplementation(async (changes: { path: string; value: unknown }[]) => {
    for (const { path, value } of changes) persisted[path] = structuredClone(value);
    return changes;
  });
  const dispatch = (action: { type: string }) => store.dispatch(action);
  for (const saga of [providerSettingsSaga, modelSelectionSaga, backgroundAgentSettingsSaga]) {
    stopSagas.push(store.runSaga(saga));
  }
  applySettingsChanges(Object.entries(saved).map(([path, value]) => ({ path, value })));
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
        { path: 'quickActions.defaultModel', value: 'basic' },
        { path: 'quickActions.defaultReasoningEffort', value: '' },
        { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
        {
          path: 'quickActions.providerSettings',
          value: {
            legacy: saved['quickActions.providerSettings'].legacy,
            codex: {
              defaultModel: 'balanced',
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
    for (const stop of stopSagas.splice(0)) stop();
    dispose?.();
    dispose = store.init();
    stopSagas.push(store.runSaga(backgroundAgentSettingsSaga));
    applySettingsChanges(Object.entries(reloaded).map(([path, value]) => ({ path, value })));
    expect(store.state.backgroundAgentSettings.defaultModel).toBe('balanced');
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
    expect(store.state.backgroundAgentSettings.defaultModel).toBe('balanced');
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

for (const perAction of [false, true]) {
  it(`retains newer ${perAction ? 'per-action' : 'shared'} effort after an older partial save event`, async () => {
    const { dispatch } = setup();
    let acknowledge!: (changes: unknown[]) => void;
    update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const choose = (effort: string) =>
      perAction
        ? setTypeReasoningEffortOverride({ type: 'fast', effort })
        : setDefaultReasoningEffort(effort);
    const path = perAction
      ? 'quickActions.typeReasoningEffortOverrides'
      : 'quickActions.defaultReasoningEffort';
    const value = (effort: string) =>
      perAction ? { commit: 'high', review: 'low', fast: effort } : effort;
    dispatch(choose('low'));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    dispatch(choose('high'));
    const applied = [{ path, value: value('low') }];
    applySettingsChanges(applied, 1);
    acknowledge(applied);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][0]).toContainEqual({ path, value: value('high') });
    expect(
      perAction
        ? store.state.backgroundAgentSettings.typeReasoningEffortOverrides.fast
        : store.state.backgroundAgentSettings.defaultReasoningEffort,
    ).toBe('high');
  });
  for (const atomic of [false, true]) {
    it(`orders a delayed ${perAction ? 'per-action' : 'shared'} effort save before provider switch (atomic ${atomic})`, async () => {
      const { dispatch, persisted } = setup();
      let acknowledge!: (changes: unknown[]) => void;
      update.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
      );
      dispatch(
        perAction
          ? setTypeReasoningEffortOverride({ type: 'fast', effort: 'high' })
          : setDefaultReasoningEffort('high'),
      );
      await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      dispatch(
        atomic
          ? setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' })
          : setActiveProvider('legacy'),
      );
      expect(update).toHaveBeenCalledTimes(1);
      const applied = [
        {
          path: perAction
            ? 'quickActions.typeReasoningEffortOverrides'
            : 'quickActions.defaultReasoningEffort',
          value: perAction ? { fast: 'high' } : 'high',
        },
      ];
      applySettingsChanges(applied, 1);
      expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('');
      expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual({});
      acknowledge(applied);
      await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
      expect(persisted['model.defaultProvider']).toBe('legacy');
      expect(persisted['quickActions.defaultReasoningEffort']).toBe('');
      expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({});
      const snapshots = persisted['quickActions.providerSettings'] as Record<
        string,
        { defaultReasoningEffort: string; typeReasoningEffortOverrides: Record<string, string> }
      >;
      expect(
        perAction
          ? snapshots.codex.typeReasoningEffortOverrides.fast
          : snapshots.codex.defaultReasoningEffort,
      ).toBe('high');
      expect(snapshots.legacy).toEqual(saved['quickActions.providerSettings'].legacy);
    });
  }
}

it('persists arbitrary effort keys, restores them across providers, and replaces the whole map', async () => {
  const { dispatch, persisted } = setup();
  dispatch(setTypeReasoningEffortOverrides({ walkthrough: 'high', 'custom-action': 'low' }));
  await vi.waitFor(() =>
    expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({
      walkthrough: 'high',
      'custom-action': 'low',
    }),
  );
  dispatch(setActiveProvider('legacy'));
  await vi.waitFor(() => expect(persisted['model.defaultProvider']).toBe('legacy'));
  dispatch(setActiveProvider('codex'));
  await vi.waitFor(() => expect(persisted['model.defaultProvider']).toBe('codex'));
  expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({
    walkthrough: 'high',
    'custom-action': 'low',
  });
  dispatch(setTypeReasoningEffortOverrides({}));
  await vi.waitFor(() =>
    expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({}),
  );
});
