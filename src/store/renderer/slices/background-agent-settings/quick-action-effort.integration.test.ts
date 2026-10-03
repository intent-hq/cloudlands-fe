import { afterEach, describe, expect, it, vi } from 'vitest';

const { update, listSnapshot } = vi.hoisted(() => ({ update: vi.fn(), listSnapshot: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { update, listSnapshot } } }));
import { store } from '../../store';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { providerSettingsSaga } from '../provider-settings/sagas/provider-settings-saga';
import { modelSelectionSaga } from '../model/sagas/model-selection-saga';
import { backgroundAgentSettingsSaga } from './sagas/background-agent-settings-saga';
import type { AppSettingChange } from '$lib/client/app-client';
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
  'model.providerDefaults': {},
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
  let revision = 0;
  const receipts: { changes: AppSettingChange[]; revision: number }[] = [];
  const commit = (changes: AppSettingChange[]) => {
    for (const { path, value } of changes) persisted[path] = structuredClone(value);
    receipts.push({ changes: structuredClone(changes), revision: ++revision });
    return structuredClone(changes);
  };
  const emit = (index = receipts.length - 1) => {
    const receipt = receipts[index];
    applySettingsChanges(structuredClone(receipt.changes), receipt.revision);
  };
  update.mockImplementation(async (changes) => commit(changes));
  listSnapshot.mockImplementation(async () => ({
    settings: Object.entries(persisted).map(([path, value]) => ({
      path,
      value: structuredClone(value),
      label: '',
      description: '',
      category: 'model',
      type: typeof value === 'string' ? 'string' : 'object',
    })),
    revision,
  }));
  const dispatch = (action: { type: string }) => store.dispatch(action);
  for (const saga of [providerSettingsSaga, modelSelectionSaga, backgroundAgentSettingsSaga]) {
    stopSagas.push(store.runSaga(saga));
  }
  applySettingsChanges(
    Object.entries(persisted).map(([path, value]) => ({ path, value: structuredClone(value) })),
    revision,
  );
  return { dispatch, persisted, commit, emit };
}

for (const atomic of [false, true]) {
  it(`persists and restores provider-local model and effort in one batch (model switch ${atomic})`, async () => {
    const { dispatch, persisted, emit } = setup();
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
    expect(listSnapshot).toHaveBeenCalledTimes(1);
    expect(store.state.model.defaultProviderId).toBe('codex');
    expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('medium');
    emit();
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
    expect(listSnapshot.mock.calls).toEqual([[], [], []]);
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

it('applies daemon provider-switch bundles even while a newer intent awaits its event', async () => {
  const { dispatch, emit } = setup();
  dispatch(setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  dispatch(setAtomicDefaultModel({ providerId: 'codex', model: 'balanced' }));
  emit(0);
  expect(store.state.model.defaultProviderId).toBe('legacy');
  expect(store.state.backgroundAgentSettings.providerId).toBe('legacy');
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('');
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(store.state.model.defaultProviderId).toBe('legacy');
  emit(1);
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
    const { commit, emit } = setup();
    commit([{ path: 'quickActions.typeReasoningEffortOverrides', value: { fast: 'high' } }]);
    emit();
    expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual({
      fast: 'high',
    });
    expect(store.state.backgroundAgentSettings.defaultModel).toBe('balanced');
    commit([{ path: 'quickActions.defaultReasoningEffort', value: null }]);
    emit();
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
    const { dispatch, commit, emit } = setup();
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
    commit(applied);
    emit();
    acknowledge(applied);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][0]).toContainEqual({ path, value: value('high') });
    expect(
      perAction
        ? store.state.backgroundAgentSettings.typeReasoningEffortOverrides.fast
        : store.state.backgroundAgentSettings.defaultReasoningEffort,
    ).toBe('high');
    expect(listSnapshot.mock.calls).toEqual([[], []]);
  });
  for (const atomic of [false, true]) {
    it(`orders a delayed ${perAction ? 'per-action' : 'shared'} effort save before provider switch (atomic ${atomic})`, async () => {
      const { dispatch, persisted, commit, emit } = setup();
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
          value: perAction ? { commit: 'high', review: 'low', fast: 'high' } : 'high',
        },
      ];
      commit(applied);
      emit();
      expect(store.state.model.defaultProviderId).toBe('codex');
      expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe(
        perAction ? 'medium' : 'high',
      );
      expect(listSnapshot.mock.calls).toEqual([[]]);
      acknowledge(applied);
      await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
      expect(listSnapshot.mock.calls).toEqual([[], []]);
      expect(store.state.model.defaultProviderId).toBe('codex');
      emit();
      expect(store.state.model.defaultProviderId).toBe('legacy');
      expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('');
      expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual({});
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
