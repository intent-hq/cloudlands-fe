import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { afterEach, expect, it, vi } from 'vitest';

const { notifyError } = vi.hoisted(() => ({ notifyError: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: notifyError } }));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});

import { BackendError } from '$lib/client/live/backend-transport-types';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { AppSettingChange } from '$lib/client/app-client';
import { store } from '../../store';
import { settingsHydrationSaga } from '../settings-events/sagas/settings-hydration-saga';
import { settingsChangesReceived } from '../settings-events/settings-events-slice';
import { providerSettingsSaga } from '../provider-settings/sagas/provider-settings-saga';
import { modelSelectionSaga } from '../model/sagas/model-selection-saga';
import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
import { backgroundAgentSettingsSaga } from './sagas/background-agent-settings-saga';
import {
  setActiveProvider,
  setAtomicDefaultModel,
} from '../provider-settings/provider-settings-slice';
import {
  backgroundProviderSwitchBlocked,
  setDefaultModel,
  setDefaultReasoningEffort,
  setTypeReasoningEffortOverride,
  setTypeReasoningEffortOverrides,
} from './background-agent-settings-slice';

const request = vi.mocked(backendRequest);
const stopSagas: (() => void)[] = [];
let dispose: (() => void) | undefined;
afterEach(async () => {
  for (const stop of stopSagas.splice(0)) stop();
  dispose?.();
  vi.resetAllMocks();
});
const emptyModels = { commit: '', pr: '', review: '', fast: '' };
const initial: AppSettingChange[] = [
  { path: 'model.defaultProvider', value: 'codex' },
  { path: 'model.providerDefaults', value: {} },
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
function assertBareModels(changes: AppSettingChange[]) {
  // Faithful to settings.rs validate_bare_model_id: the whole batch rejects.
  for (const { path, value } of changes) {
    const models = ['model.default', 'quickActions.defaultModel'].includes(path)
      ? [value]
      : ['model.providerDefaults', 'quickActions.typeOverrides'].includes(path)
        ? Object.values(value as object)
        : [];
    if (models.some((model) => typeof model === 'string' && model.includes(':')))
      throw new BackendError({
        code: 'INVALID_PARAMS',
        rpcCode: -32602,
        message: `${path}: model values must be bare model ids`,
      });
  }
}

function start() {
  dispose = store.init();
  admitLegacyPrincipal();
  for (const saga of [
    settingsHydrationSaga,
    providerSettingsSaga,
    modelSelectionSaga,
    backgroundAgentSettingsSaga,
  ])
    stopSagas.push(store.runSaga(saga));
  return (action: { type: string }) => store.dispatch(action);
}

for (const unset of [null, '']) {
  for (const edit of ['model', 'effort']) {
    it(`persists QA ${edit} with unset provider ${JSON.stringify(unset)} without inventing one`, async () => {
      const saved = new Map(initial.map(({ path, value }) => [path, structuredClone(value)]));
      saved.set('model.defaultProvider', unset);
      const writes: AppSettingChange[][] = [];
      request.mockImplementation(async (method, params) => {
        if (method === 'settings.list')
          return {
            settings: [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
            revision: writes.length ? 3 : 2,
          };
        const changes = (params as { changes: AppSettingChange[] }).changes;
        writes.push(structuredClone(changes));
        for (const { path, value } of changes) saved.set(path, structuredClone(value));
        return { applied: changes, revision: 3 };
      });
      const dispatch = start();
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.defaultModel).toBe('balanced'),
      );
      const freshOverrides = { ...emptyModels, review: 'remote-review' };
      const freshProviders = {
        other: { defaultModel: 'remote-model', typeOverrides: emptyModels },
      };
      saved.set('quickActions.defaultModel', 'remote-default');
      saved.set('quickActions.defaultReasoningEffort', 'low');
      saved.set('quickActions.typeOverrides', freshOverrides);
      saved.set('quickActions.typeReasoningEffortOverrides', { review: 'medium' });
      saved.set('quickActions.providerSettings', freshProviders);
      dispatch(
        edit === 'model' ? setDefaultModel('chosen-model') : setDefaultReasoningEffort('high'),
      );
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(true);
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
      );
      expect(writes).toEqual([
        [
          {
            path: 'quickActions.defaultModel',
            value: edit === 'model' ? 'chosen-model' : 'remote-default',
          },
          { path: 'quickActions.typeOverrides', value: freshOverrides },
          {
            path: 'quickActions.defaultReasoningEffort',
            value: edit === 'effort' ? 'high' : 'low',
          },
          { path: 'quickActions.typeReasoningEffortOverrides', value: { review: 'medium' } },
          { path: 'quickActions.providerSettings', value: freshProviders },
        ],
      ]);
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        'settings.list',
        'settings.list',
        'settings.update',
      ]);
      expect(saved.get('model.defaultProvider')).toBe(unset);
      expect(store.state.backgroundAgentSettings.pendingFields).toEqual({});
    });
  }
}

for (const unsetFields of [
  ['defaultModel'],
  ['defaultReasoningEffort'],
  ['defaultModel', 'defaultReasoningEffort'],
]) {
  for (const edit of ['model', 'effort']) {
    it(`persists QA ${edit} with null scalars ${unsetFields.join(',')} from the fresh daemon snapshot`, async () => {
      const saved = new Map(initial.map(({ path, value }) => [path, structuredClone(value)]));
      const writes: AppSettingChange[][] = [];
      request.mockImplementation(async (method, params) => {
        if (method === 'settings.list')
          return {
            settings: [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
            revision: writes.length ? 3 : 2,
          };
        const changes = (params as { changes: AppSettingChange[] }).changes;
        writes.push(structuredClone(changes));
        for (const { path, value } of changes) saved.set(path, structuredClone(value));
        return { applied: changes, revision: 3 };
      });
      const dispatch = start();
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.defaultModel).toBe('balanced'),
      );
      const freshOverrides = { ...emptyModels, review: 'remote-review' };
      const freshProviders = {
        other: { defaultModel: 'remote-model', typeOverrides: emptyModels },
      };
      saved.set('quickActions.defaultModel', 'remote-default');
      saved.set('quickActions.defaultReasoningEffort', 'low');
      for (const field of unsetFields) saved.set(`quickActions.${field}`, null);
      saved.set('quickActions.typeOverrides', freshOverrides);
      saved.set('quickActions.typeReasoningEffortOverrides', { review: 'medium' });
      saved.set('quickActions.providerSettings', freshProviders);
      dispatch(
        edit === 'model' ? setDefaultModel('chosen-model') : setDefaultReasoningEffort('high'),
      );
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(true);
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
      );
      const defaultModel =
        edit === 'model'
          ? 'chosen-model'
          : unsetFields.includes('defaultModel')
            ? ''
            : 'remote-default';
      const defaultReasoningEffort =
        edit === 'effort' ? 'high' : unsetFields.includes('defaultReasoningEffort') ? '' : 'low';
      const changes = [
        { path: 'model.defaultProvider', value: 'codex' },
        { path: 'quickActions.defaultModel', value: defaultModel },
        { path: 'quickActions.typeOverrides', value: freshOverrides },
        { path: 'quickActions.defaultReasoningEffort', value: defaultReasoningEffort },
        { path: 'quickActions.typeReasoningEffortOverrides', value: { review: 'medium' } },
        { path: 'quickActions.providerSettings', value: freshProviders },
      ];
      expect(request.mock.calls).toEqual([
        ['settings.list'],
        ['settings.list'],
        ['settings.update', { changes }],
      ]);
      expect(writes).toEqual([changes]);
      expect(store.state.backgroundAgentSettings).toMatchObject({
        defaultModel,
        defaultReasoningEffort,
        typeOverrides: freshOverrides,
        typeReasoningEffortOverrides: { review: 'medium' },
        providerSettings: freshProviders,
        pendingFields: {},
      });
    });
  }
}

for (const path of ['quickActions.defaultModel', 'quickActions.defaultReasoningEffort']) {
  for (const edit of ['model', 'effort']) {
    it(`rejects QA ${edit} with malformed non-string scalar ${path} without a write`, async () => {
      let malformed = false;
      request.mockImplementation(async () => ({
        settings: initial.map((change) =>
          malformed && change.path === path ? { ...change, value: 42 } : change,
        ),
        revision: 1,
      }));
      const dispatch = start();
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.defaultModel).toBe('balanced'),
      );
      malformed = true;
      dispatch(
        edit === 'model' ? setDefaultModel('chosen-model') : setDefaultReasoningEffort('high'),
      );
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
      );
      expect(request.mock.calls).toEqual([['settings.list'], ['settings.list']]);
      expect(store.state.backgroundAgentSettings).toMatchObject({
        defaultModel: 'balanced',
        defaultReasoningEffort: 'medium',
        pendingFields: {},
      });
    });
  }
}

it('rejects a malformed non-string provider snapshot without a QA write', async () => {
  let malformed = false;
  request.mockImplementation(async () => ({
    settings: initial.map((change) =>
      malformed && change.path === 'model.defaultProvider' ? { ...change, value: 42 } : change,
    ),
    revision: 1,
  }));
  const dispatch = start();
  await vi.waitFor(() => expect(store.state.backgroundAgentSettings.defaultModel).toBe('balanced'));
  malformed = true;
  dispatch(setDefaultReasoningEffort('high'));
  await vi.waitFor(() =>
    expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
  );
  expect(request.mock.calls.map(([method]) => method)).toEqual(['settings.list', 'settings.list']);
  expect(store.state.backgroundAgentSettings.pendingFields).toEqual({});
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('medium');
});

for (const atomic of [false, true]) {
  for (const perAction of [false, true]) {
    it(`rebases a later QA edit after an in-flight global switch without its event (atomic ${atomic}, action effort ${perAction})`, async () => {
      const saved = new Map(initial.map(({ path, value }) => [path, structuredClone(value)]));
      const snapshots = {
        legacy: {
          defaultModel: 'basic',
          typeOverrides: { ...emptyModels, review: 'review-basic' },
          defaultReasoningEffort: 'low',
          typeReasoningEffortOverrides: { review: 'medium' },
        },
        other: {
          defaultModel: 'other-model',
          typeOverrides: emptyModels,
          defaultReasoningEffort: 'low',
        },
        codex: {
          defaultModel: 'balanced',
          typeOverrides: emptyModels,
          defaultReasoningEffort: 'medium',
          typeReasoningEffortOverrides: {},
        },
      };
      saved.set('quickActions.providerSettings', {
        legacy: snapshots.legacy,
        other: snapshots.other,
      });
      const writes: AppSettingChange[][] = [];
      let release!: () => void;
      request.mockImplementation(async (method, params) => {
        if (method === 'settings.list')
          return {
            settings: [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
            revision: writes.length ? 2 : 1,
          };
        const changes = (params as { changes: AppSettingChange[] }).changes;
        writes.push(structuredClone(changes));
        if (writes.length === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        for (const { path, value } of changes) saved.set(path, structuredClone(value));
        return { applied: changes, revision: writes.length + 1 };
      });
      const dispatch = start();
      await vi.waitFor(() => expect(store.state.model.defaultProviderId).toBe('codex'));
      dispatch(
        atomic
          ? setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' })
          : setActiveProvider('legacy'),
      );
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      dispatch(
        perAction
          ? setTypeReasoningEffortOverride({ type: 'fast', effort: 'high' })
          : setDefaultReasoningEffort('high'),
      );
      expect(writes).toHaveLength(1);
      expect(store.state.model.defaultProviderId).toBe('codex');
      release();
      await vi.waitFor(() => expect(writes).toHaveLength(2));
      const globalChanges = [
        { path: 'model.defaultProvider', value: 'legacy' },
        ...(atomic ? [{ path: 'model.providerDefaults', value: { legacy: 'basic' } }] : []),
        { path: 'quickActions.defaultModel', value: 'basic' },
        { path: 'quickActions.typeOverrides', value: snapshots.legacy.typeOverrides },
        { path: 'quickActions.defaultReasoningEffort', value: 'low' },
        { path: 'quickActions.typeReasoningEffortOverrides', value: { review: 'medium' } },
        { path: 'quickActions.providerSettings', value: snapshots },
      ];
      expect(writes[0]).toEqual(globalChanges);
      expect(writes[1]).toEqual([
        { path: 'model.defaultProvider', value: 'legacy' },
        { path: 'quickActions.defaultModel', value: 'basic' },
        { path: 'quickActions.typeOverrides', value: snapshots.legacy.typeOverrides },
        { path: 'quickActions.defaultReasoningEffort', value: perAction ? 'low' : 'high' },
        {
          path: 'quickActions.typeReasoningEffortOverrides',
          value: perAction ? { review: 'medium', fast: 'high' } : { review: 'medium' },
        },
        { path: 'quickActions.providerSettings', value: snapshots },
      ]);
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        'settings.list',
        'settings.list',
        'settings.update',
        'settings.list',
        'settings.update',
      ]);
      expect(saved.get('model.defaultProvider')).toBe('legacy');
      expect(saved.get('quickActions.providerSettings')).toEqual(snapshots);
      expect(store.state.model.defaultProviderId).toBe('codex');
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
      );
      dispatch(settingsChangesReceived(globalChanges, 2));
      dispatch(settingsChangesReceived(writes[1], 3));
      expect(store.state.model.defaultProviderId).toBe('legacy');
      expect(store.state.backgroundAgentSettings).toMatchObject({
        providerId: 'legacy',
        defaultModel: 'basic',
        defaultReasoningEffort: perAction ? 'low' : 'high',
        typeReasoningEffortOverrides: perAction
          ? { review: 'medium', fast: 'high' }
          : { review: 'medium' },
        providerSettings: snapshots,
      });
    });
  }
}

it('does not write a later QA edit from stale Redux when its fresh snapshot read fails', async () => {
  const saved = new Map(initial.map(({ path, value }) => [path, structuredClone(value)]));
  const writes: AppSettingChange[][] = [];
  let release!: () => void;
  let rejectSnapshot = false;
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') {
      if (rejectSnapshot) throw new Error('snapshot unavailable');
      return {
        settings: [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
        revision: 1,
      };
    }
    const changes = (params as { changes: AppSettingChange[] }).changes;
    writes.push(structuredClone(changes));
    if (writes.length === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    for (const { path, value } of changes) saved.set(path, structuredClone(value));
    return { applied: changes, revision: 2 };
  });
  const dispatch = start();
  await vi.waitFor(() => expect(store.state.model.defaultProviderId).toBe('codex'));
  dispatch(setActiveProvider('legacy'));
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  dispatch(setDefaultReasoningEffort('high'));
  rejectSnapshot = true;
  release();
  await vi.waitFor(() =>
    expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
  );
  expect(writes).toHaveLength(1);
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    'settings.list',
    'settings.list',
    'settings.update',
    'settings.list',
  ]);
  expect(saved.get('model.defaultProvider')).toBe('legacy');
  expect(saved.get('quickActions.defaultReasoningEffort')).toBe('');
  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(store.state.backgroundAgentSettings.pendingFields).toEqual({});
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('medium');
  rejectSnapshot = false;
  dispatch(setDefaultReasoningEffort('low'));
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(saved.get('model.defaultProvider')).toBe('legacy');
  expect(saved.get('quickActions.defaultReasoningEffort')).toBe('low');
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    'settings.list',
    'settings.list',
    'settings.update',
    'settings.list',
    'settings.list',
    'settings.update',
  ]);
});

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
        if (method === 'settings.list')
          return {
            settings: Object.entries(persisted).map(([path, value]) => ({
              path,
              value: structuredClone(value),
            })),
            revision,
          };
        const changes = (params as { changes: AppSettingChange[] }).changes;
        assertBareModels(changes);
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
      expect(store.state.backgroundAgentSettings.providerId).toBe('codex');
      expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe(
        perAction ? 'medium' : 'high',
      );
      expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual(
        perAction ? { fast: 'high' } : {},
      );
      release();
      await vi.waitFor(() => expect(writes).toHaveLength(3));
      await vi.waitFor(() =>
        expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
      );
      expect(persisted['model.defaultProvider']).toBe('legacy');
      expect(persisted['quickActions.defaultReasoningEffort']).toBe('');
      expect(persisted['quickActions.typeReasoningEffortOverrides']).toEqual({});
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        'settings.list',
        'settings.list',
        'settings.update',
        'settings.list',
        'settings.update',
        'settings.list',
        'settings.update',
      ]);
      const providerSnapshots = {
        legacy: { defaultModel: 'basic', typeOverrides: emptyModels },
        other: {
          defaultModel: 'other-model',
          typeOverrides: emptyModels,
          defaultReasoningEffort: 'low',
        },
      };
      expect(writes.slice(0, 2)).toEqual(
        ['low', 'high'].map((effort) => [
          { path: 'model.defaultProvider', value: 'codex' },
          { path: 'quickActions.defaultModel', value: 'balanced' },
          { path: 'quickActions.typeOverrides', value: emptyModels },
          { path: 'quickActions.defaultReasoningEffort', value: perAction ? 'medium' : effort },
          {
            path: 'quickActions.typeReasoningEffortOverrides',
            value: perAction ? { fast: effort } : {},
          },
          { path: 'quickActions.providerSettings', value: providerSnapshots },
        ]),
      );
      expect(writes[2]).toEqual([
        { path: 'model.defaultProvider', value: 'legacy' },
        ...(atomic ? [{ path: 'model.providerDefaults', value: { legacy: 'basic' } }] : []),
        { path: 'quickActions.defaultModel', value: 'basic' },
        { path: 'quickActions.typeOverrides', value: emptyModels },
        { path: 'quickActions.defaultReasoningEffort', value: '' },
        { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
        {
          path: 'quickActions.providerSettings',
          value: {
            ...providerSnapshots,
            codex: {
              defaultModel: 'balanced',
              typeOverrides: emptyModels,
              defaultReasoningEffort: perAction ? 'medium' : 'high',
              typeReasoningEffortOverrides: perAction ? { fast: 'high' } : {},
            },
          },
        },
      ]);
      expect(store.state.model.defaultProviderId).toBe('codex');
      dispatch(settingsChangesReceived(writes[2], revision));
      expect(store.state.model.defaultProviderId).toBe('legacy');
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
      dispatch(settingsChangesReceived(writes[3], revision));
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

it.each(['failure', 'connection-change'] as const)(
  'releases the admitted QA drain barrier on %s',
  async (outcome) => {
    const saved = new Map(initial.map(({ path, value }) => [path, structuredClone(value)]));
    const writes: AppSettingChange[][] = [];
    let release!: () => void;
    request.mockImplementation(async (method, params) => {
      if (method === 'settings.list')
        return {
          settings: [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
          revision: 1,
        };
      const changes = (params as { changes: AppSettingChange[] }).changes;
      writes.push(changes);
      if (writes.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw new BackendError({ code: 'INVALID_PARAMS', rpcCode: -32602, message: 'rejected' });
      }
      for (const { path, value } of changes) saved.set(path, structuredClone(value));
      return { applied: changes, revision: 2 };
    });
    const dispatch = start();
    await vi.waitFor(() => expect(store.state.model.defaultProviderId).toBe('codex'));
    dispatch(setDefaultReasoningEffort('high'));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    dispatch(setActiveProvider('legacy'));
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'settings.list',
      'settings.list',
      'settings.update',
    ]);
    if (outcome === 'connection-change') dispatch(hostExecutionConnectionChanged('replacement'));
    release();
    await vi.waitFor(() =>
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
    );
    if (outcome === 'connection-change') {
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        'settings.list',
        'settings.list',
        'settings.update',
      ]);
      expect(saved.get('model.defaultProvider')).toBe('codex');
      expect(store.state.model.defaultProviderId).toBe('');
    } else {
      await vi.waitFor(() => expect(writes).toHaveLength(2));
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        'settings.list',
        'settings.list',
        'settings.update',
        'settings.list',
        'settings.update',
      ]);
      const snapshots = saved.get('quickActions.providerSettings') as Record<
        string,
        { defaultReasoningEffort: string }
      >;
      expect(snapshots.codex.defaultReasoningEffort).toBe('medium');
      expect(saved.get('model.defaultProvider')).toBe('legacy');
      expect(store.state.model.defaultProviderId).toBe('codex');
      dispatch(settingsChangesReceived(writes[1], 2));
      expect(store.state.model.defaultProviderId).toBe('legacy');
      expect(store.state.backgroundAgentSettings.defaultModel).toBe('basic');
    }
  },
);

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
  const writes: AppSettingChange[][] = [];
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') return { settings: initial, revision: 2 };
    const changes = (params as { changes: AppSettingChange[] }).changes;
    writes.push(changes);
    return { applied: changes, revision: 3 };
  });
  dispatch(setActiveProvider('legacy'));
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('low');
  dispatch(settingsChangesReceived(writes[0], 3));
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
      if (method === 'settings.list')
        return {
          settings: Object.entries(persisted).map(([path, value]) => ({
            path,
            value: structuredClone(value),
          })),
          revision,
        };
      const changes = (params as { changes: AppSettingChange[] }).changes;
      assertBareModels(changes);
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
    await vi.waitFor(() => expect(updates).toBe(4));
    await vi.waitFor(() => expect(persisted['model.defaultProvider']).toBe('codex'));
    expect(persisted['quickActions.defaultReasoningEffort']).toBe('high');
    expect(store.state.backgroundAgentSettings.providerId).toBe('codex');
  },
);

for (const path of ['quickActions.defaultModel', 'quickActions.typeOverrides']) {
  for (const legacyModel of ['codex:balanced', 'claude-code:foreign-model']) {
    it(`saves an ordinary default model without rewriting legacy ${path} ${legacyModel}`, async () => {
      const legacyValue = path.endsWith('typeOverrides')
        ? { ...emptyModels, commit: legacyModel }
        : legacyModel;
      const snapshot = initial.map((change) =>
        change.path === path ? { ...change, value: legacyValue } : change,
      );
      const persisted = Object.fromEntries(
        snapshot.map(({ path, value }) => [path, structuredClone(value)]),
      );
      let revision = 1;
      const writes: AppSettingChange[][] = [];
      request.mockImplementation(async (method, params) => {
        if (method === 'settings.list') return { settings: snapshot, revision };
        const changes = (params as { changes: AppSettingChange[] }).changes;
        assertBareModels(changes);
        writes.push(changes);
        for (const { path, value } of changes) persisted[path] = structuredClone(value);
        return { applied: changes, revision: ++revision };
      });
      const dispatch = start();
      await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
      dispatch(setAtomicDefaultModel({ providerId: 'codex', model: 'new-default' }));
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      expect(store.state.model.providerModels).toEqual({});
      expect(persisted['model.providerDefaults']).toEqual({ codex: 'new-default' });
      expect(persisted[path]).toEqual(legacyValue);
      expect(writes[0].some((change) => change.path.startsWith('quickActions.'))).toBe(false);
      expect(store.state.backgroundAgentSettings.persistencePending ?? false).toBe(false);
    });
  }
}

for (const atomic of [false, true]) {
  for (const field of ['defaultModel', 'typeOverrides']) {
    it(`rejects an unsafe provider snapshot before optimistic state or persistence changes (atomic ${atomic}, ${field})`, async () => {
      const unsafeSnapshot = {
        defaultModel: field === 'defaultModel' ? 'codex:foreign-model' : 'basic',
        typeOverrides: {
          ...emptyModels,
          commit: field === 'typeOverrides' ? 'codex:foreign-model' : '',
        },
        defaultReasoningEffort: 'high',
      };
      const settings = initial.map((change) =>
        change.path === 'quickActions.providerSettings'
          ? { ...change, value: { legacy: unsafeSnapshot } }
          : change,
      );
      const persisted = Object.fromEntries(
        settings.map(({ path, value }) => [path, structuredClone(value)]),
      );
      request.mockImplementation(async (method, params) => {
        if (method === 'settings.list') return { settings, revision: 1 };
        const changes = (params as { changes: AppSettingChange[] }).changes;
        assertBareModels(changes);
        for (const { path, value } of changes) persisted[path] = structuredClone(value);
        return { applied: changes, revision: 2 };
      });
      start();
      await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
      const beforeModel = store.state.model;
      const beforeBackground = store.state.backgroundAgentSettings;
      // Use the configured store's real middleware, not a hand-fed saga channel.
      store.dispatch(
        atomic
          ? setAtomicDefaultModel({ providerId: 'legacy', model: 'new-model' })
          : setActiveProvider('legacy'),
      );
      expect(store.state.model).toBe(beforeModel);
      expect(store.state.backgroundAgentSettings).toBe(beforeBackground);
      expect(store.state.backgroundAgentSettings.providerSettings.legacy).toEqual(unsafeSnapshot);
      expect(request).toHaveBeenCalledTimes(1); // settings.list only; no rejected batch reaches the daemon.
      await vi.waitFor(() =>
        expect(notifyError).toHaveBeenCalledWith(
          expect.stringContaining('quickActions.providerSettings'),
        ),
      );
      store.dispatch(setAtomicDefaultModel({ providerId: 'codex', model: 'valid-next' }));
      await vi.waitFor(() =>
        expect(persisted['model.providerDefaults']).toEqual({ codex: 'valid-next' }),
      );
      expect(persisted['model.defaultProvider']).toBe('codex');
      expect(persisted['quickActions.providerSettings']).toEqual({ legacy: unsafeSnapshot });
    });
  }
}

it('provides actionable guidance for a blocked provider switch without a settings write', async () => {
  request.mockResolvedValue({ settings: initial, revision: 1 });
  const dispatch = start();
  await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
  dispatch(backgroundProviderSwitchBlocked('legacy'));
  await vi.waitFor(() =>
    expect(notifyError).toHaveBeenCalledWith(
      expect.stringContaining('quickActions.providerSettings'),
    ),
  );
  expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('legacy'));
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not acknowledge a pending effort edit when a same-provider model-only save settles', async () => {
  const releases: (() => void)[] = [];
  const writes: AppSettingChange[][] = [];
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') return { settings: initial, revision: 1 };
    const changes = (params as { changes: AppSettingChange[] }).changes;
    assertBareModels(changes);
    writes.push(changes);
    const revision = writes.length + 1;
    await new Promise<void>((resolve) => releases.push(resolve));
    return { applied: changes, revision };
  });
  const dispatch = start();
  await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
  dispatch(setAtomicDefaultModel({ providerId: 'codex', model: 'new-model' }));
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  dispatch(setDefaultReasoningEffort('high'));
  releases[0]();
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0].some(({ path }) => path.startsWith('quickActions.'))).toBe(false);
  expect(store.state.backgroundAgentSettings.persistencePending).toBe(true);
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('high');
  releases[1]();
  await vi.waitFor(() =>
    expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
  );
});

it.each(['partial', 'full', 'rejected', 'no-op'] as const)(
  'reconciles newer external authority after a delayed %s save result',
  async (response) => {
    const writes: AppSettingChange[][] = [];
    const saved = new Map(initial.map(({ path, value }) => [path, structuredClone(value)]));
    let revision = 7;
    const commit = (changes: AppSettingChange[], nextRevision: number) => {
      for (const { path, value } of changes) saved.set(path, structuredClone(value));
      revision = nextRevision;
      return settingsChangesReceived(changes, nextRevision);
    };
    let release!: () => void;
    request.mockImplementation(async (method, params) => {
      if (method === 'settings.list')
        return {
          settings: [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
          revision,
        };
      const changes = (params as { changes: AppSettingChange[] }).changes;
      writes.push(changes);
      if (writes.length === 1) {
        if (response !== 'rejected') commit(changes, response === 'no-op' ? 7 : 8);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (response === 'rejected')
          throw new BackendError({ code: 'INVALID_PARAMS', rpcCode: -32602, message: 'rejected' });
        return {
          applied:
            response === 'no-op'
              ? []
              : response === 'full'
                ? changes
                : changes.filter(({ path }) => path === 'quickActions.defaultReasoningEffort'),
          revision: response === 'no-op' ? 7 : 8,
        };
      }
      commit(changes, 10);
      return { applied: changes, revision: 10 };
    });
    const dispatch = start();
    await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
    dispatch(setDefaultReasoningEffort(response === 'no-op' ? 'medium' : 'low'));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    dispatch(commit([{ path: 'quickActions.defaultReasoningEffort', value: 'high' }], 9));
    release();
    await vi.waitFor(() =>
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
    );
    expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('high');
    dispatch(setTypeReasoningEffortOverride({ type: 'fast', effort: 'medium' }));
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toContainEqual({
      path: 'quickActions.defaultReasoningEffort',
      value: 'high',
    });
  },
);

it.each(['entry', 'clear', 'replace', 'shared'] as const)(
  'rebases queued %s effort on multiple newer partial authoritative deltas',
  async (edit) => {
    const writes: AppSettingChange[][] = [];
    const saved = new Map(initial.map(({ path, value }) => [path, structuredClone(value)]));
    let revision = 7;
    const commit = (changes: AppSettingChange[], nextRevision: number) => {
      for (const { path, value } of changes) saved.set(path, structuredClone(value));
      revision = nextRevision;
      return settingsChangesReceived(changes, nextRevision);
    };
    let release!: () => void;
    request.mockImplementation(async (method, params) => {
      if (method === 'settings.list')
        return {
          settings: [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
          revision,
        };
      const changes = (params as { changes: AppSettingChange[] }).changes;
      writes.push(changes);
      commit(changes, writes.length === 1 ? 8 : 11);
      if (writes.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { applied: changes, revision: 8 };
      }
      return { applied: changes, revision: 11 };
    });
    const dispatch = start();
    await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
    dispatch(setDefaultReasoningEffort('low'));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    dispatch(
      edit === 'shared'
        ? setDefaultReasoningEffort('medium')
        : edit === 'replace'
          ? setTypeReasoningEffortOverrides({ walkthrough: 'medium' })
          : setTypeReasoningEffortOverride({
              type: 'fast',
              effort: edit === 'clear' ? '' : 'high',
            }),
    );
    dispatch(commit([{ path: 'quickActions.defaultReasoningEffort', value: 'high' }], 9));
    dispatch(
      commit(
        [
          {
            path: 'quickActions.typeReasoningEffortOverrides',
            value: { commit: 'low', fast: 'low' },
          },
        ],
        10,
      ),
    );
    release();
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toContainEqual({
      path: 'quickActions.defaultReasoningEffort',
      value: edit === 'shared' ? 'medium' : 'high',
    });
    expect(writes[1]).toContainEqual({
      path: 'quickActions.typeReasoningEffortOverrides',
      value:
        edit === 'replace'
          ? { walkthrough: 'medium' }
          : edit === 'clear'
            ? { commit: 'low' }
            : { commit: 'low', fast: edit === 'shared' ? 'low' : 'high' },
    });
    await vi.waitFor(() =>
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(false),
    );
  },
);

it.each(
  ['effort', 'provider', 'atomic'].flatMap((lane) =>
    ['full', 'partial', 'rejected'].map((response) => ({ lane, response })),
  ),
)('reconciles a newer remote provider after $lane $response', async ({ lane, response }) => {
  const writes: AppSettingChange[][] = [];
  const persisted = Object.fromEntries(
    initial.map(({ path, value }) => [path, structuredClone(value)]),
  );
  let revision = 7;
  const commit = (changes: AppSettingChange[], nextRevision: number) => {
    for (const { path, value } of changes) persisted[path] = structuredClone(value);
    revision = nextRevision;
  };
  let release!: () => void;
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.list')
      return {
        settings: Object.entries(persisted).map(([path, value]) => ({
          path,
          value: structuredClone(value),
        })),
        revision,
      };
    const changes = (params as { changes: AppSettingChange[] }).changes;
    writes.push(changes);
    const applied =
      response === 'partial'
        ? changes.filter(
            ({ path, value }) => JSON.stringify(persisted[path]) !== JSON.stringify(value),
          )
        : changes;
    const writeRevision = writes.length === 1 ? 8 : 11;
    // Commit before delaying the acknowledgement; later external revisions must survive it.
    if (writes.length !== 1 || response !== 'rejected') commit(changes, writeRevision);
    if (writes.length === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (response === 'rejected')
        throw new BackendError({ code: 'INVALID_PARAMS', rpcCode: -32602, message: 'rejected' });
    }
    return { applied, revision: writeRevision };
  });
  const dispatch = start();
  await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
  dispatch(
    lane === 'effort'
      ? setDefaultReasoningEffort('low')
      : lane === 'atomic'
        ? setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' })
        : setActiveProvider('legacy'),
  );
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  const externalProvider: AppSettingChange[] = [
    { path: 'model.defaultProvider', value: 'other' },
    { path: 'quickActions.defaultModel', value: 'other-model' },
    { path: 'quickActions.defaultReasoningEffort', value: 'high' },
  ];
  commit(externalProvider, 9);
  dispatch(settingsChangesReceived(externalProvider, 9));
  const externalEffort: AppSettingChange[] = [
    { path: 'quickActions.typeReasoningEffortOverrides', value: { walkthrough: 'low' } },
  ];
  commit(externalEffort, 10);
  dispatch(settingsChangesReceived(externalEffort, 10));
  release();
  await vi.waitFor(() => {
    expect(store.state.backgroundAgentSettings.persistencePending ?? false).toBe(false);
    expect(store.state.model.defaultProviderId).toBe('other');
  });
  await vi.waitFor(() =>
    expect(request.mock.calls.filter(([method]) => method === 'settings.list')).toHaveLength(
      lane === 'effort' ? 2 : response === 'rejected' ? 3 : 2,
    ),
  );
  expect(store.state.model.defaultProviderId).toBe('other');
  expect(store.state.backgroundAgentSettings.providerId).toBe('other');
  expect(store.state.backgroundAgentSettings.defaultModel).toBe('other-model');
  expect(store.state.backgroundAgentSettings.defaultReasoningEffort).toBe('high');
  dispatch(setTypeReasoningEffortOverride({ type: 'fast', effort: 'medium' }));
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toContainEqual({ path: 'model.defaultProvider', value: 'other' });
  expect(writes[1]).toContainEqual({
    path: 'quickActions.typeReasoningEffortOverrides',
    value: { walkthrough: 'low', fast: 'medium' },
  });
});

it.each([false, true])(
  'attributes a quick-action-only external delta after local switch settlement (rejected %s)',
  async (rejected) => {
    let release!: () => void;
    request.mockImplementation(async (method, params) => {
      if (method === 'settings.list') return { settings: initial, revision: 7 };
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (rejected)
        throw new BackendError({ code: 'INVALID_PARAMS', rpcCode: -32602, message: 'rejected' });
      return { applied: (params as { changes: AppSettingChange[] }).changes, revision: 8 };
    });
    const dispatch = start();
    await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
    dispatch(setActiveProvider('legacy'));
    await vi.waitFor(() => expect(release).toBeDefined());
    // A partial event has no provider label; ownership follows the committed provider revision.
    dispatch(
      settingsChangesReceived([{ path: 'quickActions.defaultReasoningEffort', value: 'high' }], 9),
    );
    release();
    await vi.waitFor(() =>
      expect(store.state.backgroundAgentSettings.persistencePending ?? false).toBe(false),
    );
    expect(store.state.model.defaultProviderId).toBe('codex');
    expect(store.state.backgroundAgentSettings).toMatchObject({
      providerId: 'codex',
      defaultModel: 'balanced',
      defaultReasoningEffort: 'high',
    });
  },
);

it.each([false, true])(
  'settles provider intent when an unrelated revision overtakes its acknowledgement (atomic %s)',
  async (atomic) => {
    const writes: AppSettingChange[][] = [];
    const saved = new Map(initial.map(({ path, value }) => [path, structuredClone(value)]));
    let snapshotRevision = 7;
    const commit = (changes: AppSettingChange[], revision: number) => {
      for (const { path, value } of changes) saved.set(path, structuredClone(value));
      snapshotRevision = revision;
      return settingsChangesReceived(changes, revision);
    };
    let release!: () => void;
    request.mockImplementation(async (method, params) => {
      if (method === 'settings.list')
        return {
          settings: [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
          revision: snapshotRevision,
        };
      const changes = (params as { changes: AppSettingChange[] }).changes;
      writes.push(changes);
      const revision = writes.length === 1 ? 8 : 11;
      commit(changes, revision);
      if (writes.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { applied: changes, revision };
    });
    const dispatch = start();
    await vi.waitFor(() => expect(store.state.backgroundAgentSettings.providerId).toBe('codex'));
    dispatch(
      atomic
        ? setAtomicDefaultModel({ providerId: 'legacy', model: 'basic' })
        : setActiveProvider('legacy'),
    );
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    dispatch(commit([{ path: 'notifications.volume', value: 0.25 }], 9));
    release();
    await vi.waitFor(() =>
      expect(store.state.backgroundAgentSettings.persistencePending ?? false).toBe(false),
    );
    expect(store.state.model.defaultProviderId).toBe('codex');
    dispatch(
      commit(
        [
          { path: 'model.defaultProvider', value: 'other' },
          { path: 'quickActions.defaultModel', value: 'other-model' },
          { path: 'quickActions.defaultReasoningEffort', value: 'high' },
        ],
        10,
      ),
    );
    expect(store.state.model.defaultProviderId).toBe('other');
    expect(store.state.backgroundAgentSettings).toMatchObject({
      providerId: 'other',
      defaultModel: 'other-model',
      defaultReasoningEffort: 'high',
    });
    dispatch(setTypeReasoningEffortOverride({ type: 'fast', effort: 'medium' }));
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toContainEqual({ path: 'model.defaultProvider', value: 'other' });
    expect(writes[1]).toContainEqual({
      path: 'quickActions.defaultReasoningEffort',
      value: 'high',
    });
  },
);
