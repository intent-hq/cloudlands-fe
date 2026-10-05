import { afterEach, expect, it, vi } from 'vitest';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';

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
import { BackendError } from '$lib/client/live/backend-transport-types';
import type {
  AppSettingChange,
  AppliedSettingChange,
  SettingsUpdateResult,
} from '$lib/client/app-client';
import { store } from '$store/renderer/store';
import { setSelectedModel, setDefaultReasoningEffort } from '../model-slice';
import {
  setAtomicDefaultModel,
  setActiveProvider,
} from '../../provider-settings/provider-settings-slice';
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import { providerSettingsSaga } from '../../provider-settings/sagas/provider-settings-saga';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import { settingsHydrationSaga } from '../../settings-events/sagas/settings-hydration-saga';
import { modelSelectionSaga } from './model-selection-saga';

const request = vi.mocked(backendRequest);
const cancelSagas: (() => void)[] = [];
let dispose: (() => void) | undefined;

afterEach(() => {
  for (const cancel of cancelSagas.splice(0)) cancel();
  dispose?.();
  vi.useRealTimers();
  vi.resetAllMocks();
});

const settle = async () => {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
};

const emptyBackground = {
  defaultModel: '',
  typeOverrides: { commit: '', pr: '', review: '', fast: '' },
  defaultReasoningEffort: '',
  typeReasoningEffortOverrides: {},
};
const initialModels = { grok: 'grok4.5', codex: 'gpt-6-astra' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function mockDaemon() {
  const values: Record<string, AppSettingChange['value']> = {
    'model.defaultProvider': 'grok',
    'model.providerDefaults': { ...initialModels },
    'model.defaultReasoningEffort': 'low',
    'quickActions.defaultModel': '',
    'quickActions.typeOverrides': { ...emptyBackground.typeOverrides },
    'quickActions.defaultReasoningEffort': '',
    'quickActions.typeReasoningEffortOverrides': {},
    'quickActions.providerSettings': {},
  };
  let revision = 7;
  const snapshot = () => ({
    settings: Object.entries(values).map(([path, value]) => ({
      path,
      value: structuredClone(value),
    })),
    revision,
  });
  const commit = (changes: AppSettingChange[]): SettingsUpdateResult => {
    const applied: AppliedSettingChange[] = [];
    for (const change of changes) {
      if (JSON.stringify(values[change.path]) === JSON.stringify(change.value)) continue;
      values[change.path] = structuredClone(change.value);
      applied.push({ ...structuredClone(change), origin: 'file' });
    }
    if (applied.length) revision += 1;
    return { applied, revision };
  };
  const read = vi.fn(async () => snapshot());
  const update = vi.fn(async (changes: AppSettingChange[]) => commit(changes));
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') return read();
    if (method === 'settings.update')
      return update((params as { changes: AppSettingChange[] }).changes);
    throw new Error(`Unexpected request ${method}`);
  });
  return { snapshot, commit, read, update };
}

function startOwners() {
  dispose = store.init();
  store.dispatch(hostExecutionConnectionChanged('connection-A'));
  admitLegacyPrincipal();
  cancelSagas.push(
    store.runSaga(settingsHydrationSaga),
    store.runSaga(providerSettingsSaga),
    store.runSaga(modelSelectionSaga),
  );
}

const rendered = () => ({
  provider: store.state.model.defaultProviderId,
  models: store.state.model.providerModels,
  effort: store.state.model.defaultReasoningEffort,
});
const initialRendered = { provider: 'grok', models: initialModels, effort: 'low' };
const modelChanges = (models: Record<string, string>): AppSettingChange[] => [
  { path: 'model.providerDefaults', value: models },
];
const effortChanges = (value: string): AppSettingChange[] => [
  { path: 'model.defaultReasoningEffort', value },
];
const switchChanges: AppSettingChange[] = [
  { path: 'model.defaultProvider', value: 'codex' },
  { path: 'quickActions.defaultModel', value: '' },
  { path: 'quickActions.typeOverrides', value: emptyBackground.typeOverrides },
  { path: 'quickActions.defaultReasoningEffort', value: '' },
  { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
  { path: 'quickActions.providerSettings', value: { grok: emptyBackground } },
];
const cases = [
  {
    kind: 'model',
    intent: () => setSelectedModel({ providerId: 'grok', model: 'grok-new' }),
    changes: modelChanges({ grok: 'grok-new', codex: 'gpt-6-astra' }),
    received: { ...initialRendered, models: { grok: 'grok-new', codex: 'gpt-6-astra' } },
  },
  {
    kind: 'provider',
    intent: () => setActiveProvider('codex'),
    changes: switchChanges,
    received: { ...initialRendered, provider: 'codex' },
  },
  {
    kind: 'atomic',
    intent: () => setAtomicDefaultModel({ providerId: 'codex', model: 'codex-new' }),
    changes: [
      switchChanges[0],
      ...modelChanges({ grok: 'grok4.5', codex: 'codex-new' }),
      ...switchChanges.slice(1),
    ],
    received: {
      ...initialRendered,
      provider: 'codex',
      models: { grok: 'grok4.5', codex: 'codex-new' },
    },
  },
  {
    kind: 'effort',
    intent: () => setDefaultReasoningEffort('high'),
    changes: effortChanges('high'),
    received: { ...initialRendered, effort: 'high' },
  },
] as const;

const providerSwitchCases = cases.filter(({ kind }) => kind === 'provider' || kind === 'atomic');
const malformedSwitchSnapshots: {
  label: string;
  path: string;
  value?: unknown;
  omit?: boolean;
}[] = [
  { label: 'numeric provider map', path: 'quickActions.providerSettings', value: 42 },
  { label: 'null provider map', path: 'quickActions.providerSettings', value: null },
  { label: 'missing provider map entry', path: 'quickActions.providerSettings', omit: true },
  { label: 'missing active model entry', path: 'quickActions.defaultModel', omit: true },
  { label: 'numeric active model', path: 'quickActions.defaultModel', value: 42 },
  { label: 'array active model overrides', path: 'quickActions.typeOverrides', value: [] },
  { label: 'numeric active effort', path: 'quickActions.defaultReasoningEffort', value: 42 },
  {
    label: 'non-string active effort override',
    path: 'quickActions.typeReasoningEffortOverrides',
    value: { review: 42 },
  },
  { label: 'numeric previous provider', path: 'model.defaultProvider', value: 42 },
  ...[
    'model.defaultProvider',
    'quickActions.typeOverrides',
    'quickActions.defaultReasoningEffort',
    'quickActions.typeReasoningEffortOverrides',
  ].map((path) => ({ label: `missing ${path}`, path, omit: true })),
  ...[
    { defaultModel: 42 },
    { typeOverrides: { review: 42 } },
    { defaultReasoningEffort: 42 },
    { typeReasoningEffortOverrides: { review: 42 } },
  ].map((invalid) => ({
    label: `malformed saved ${Object.keys(invalid)[0]}`,
    path: 'quickActions.providerSettings',
    value: { codex: { ...emptyBackground, ...invalid } },
  })),
];

it.each(
  providerSwitchCases.flatMap((scenario) =>
    malformedSwitchSnapshots.map((malformed) => ({ ...scenario, ...malformed })),
  ),
)(
  'rejects malformed switch snapshot: $kind / $label without replacing daemon settings',
  async ({ intent, path, value, omit }) => {
    const daemon = mockDaemon();
    daemon.commit([
      {
        path: 'quickActions.providerSettings',
        value: { auggie: { ...emptyBackground, defaultModel: 'saved-auggie' } },
      },
    ]);
    startOwners();
    await settle();
    const before = daemon.snapshot();
    const snapshot = {
      ...before,
      settings: before.settings.flatMap((change) =>
        change.path !== path ? [change] : omit ? [] : [{ ...change, value }],
      ),
    };
    daemon.read.mockResolvedValueOnce(snapshot);
    store.dispatch(intent());
    await settle();
    expect(request.mock.calls).toEqual([['settings.list'], ['settings.list']]);
    expect(daemon.update).not.toHaveBeenCalled();
    expect(daemon.snapshot()).toEqual(before);
    expect(rendered()).toEqual(initialRendered);
  },
);

it.each(providerSwitchCases)(
  'normalizes valid unset switch snapshot: $kind preserves other providers and empty active defaults',
  async ({ kind, intent }) => {
    const daemon = mockDaemon();
    const otherProvider = { ...emptyBackground, defaultModel: 'saved-auggie' };
    daemon.commit([
      { path: 'quickActions.defaultModel', value: null },
      { path: 'quickActions.typeOverrides', value: {} },
      { path: 'quickActions.defaultReasoningEffort', value: null },
      { path: 'quickActions.providerSettings', value: { auggie: otherProvider } },
    ]);
    startOwners();
    await settle();
    store.dispatch(intent());
    await settle();
    expect(request.mock.calls).toEqual([
      ['settings.list'],
      ['settings.list'],
      [
        'settings.update',
        {
          changes: [
            { path: 'model.defaultProvider', value: 'codex' },
            ...(kind === 'atomic' ? modelChanges({ grok: 'grok4.5', codex: 'codex-new' }) : []),
            { path: 'quickActions.defaultModel', value: '' },
            { path: 'quickActions.typeOverrides', value: emptyBackground.typeOverrides },
            { path: 'quickActions.defaultReasoningEffort', value: '' },
            { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
            {
              path: 'quickActions.providerSettings',
              value: {
                auggie: otherProvider,
                grok: { ...emptyBackground, typeOverrides: {} },
              },
            },
          ],
        },
      ],
    ]);
    expect(rendered()).toEqual(initialRendered);
  },
);

it.each([null, ''])(
  'preserves valid unset previous provider %j and restores a snapshot with absent effort members',
  async (provider) => {
    const daemon = mockDaemon();
    const snapshots = {
      codex: { defaultModel: 'saved-codex', typeOverrides: { review: 'saved-review' } },
      auggie: { ...emptyBackground, defaultModel: 'saved-auggie' },
    };
    daemon.commit([
      { path: 'model.defaultProvider', value: provider },
      { path: 'quickActions.providerSettings', value: snapshots },
    ]);
    startOwners();
    await settle();
    store.dispatch(setActiveProvider('codex'));
    await settle();
    expect(request.mock.calls).toEqual([
      ['settings.list'],
      ['settings.list'],
      [
        'settings.update',
        {
          changes: [
            { path: 'model.defaultProvider', value: 'codex' },
            { path: 'quickActions.defaultModel', value: 'saved-codex' },
            { path: 'quickActions.typeOverrides', value: { review: 'saved-review' } },
            { path: 'quickActions.defaultReasoningEffort', value: '' },
            { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
            { path: 'quickActions.providerSettings', value: snapshots },
          ],
        },
      ],
    ]);
    expect(rendered()).toEqual({ ...initialRendered, provider: '' });
  },
);

it.each(cases.flatMap((scenario) => ['before', 'after'].map((order) => ({ ...scenario, order }))))(
  'renders $kind daemon events $order acknowledgement, never intent or RPC response',
  async ({ intent, changes, received, kind, order }) => {
    const daemon = mockDaemon();
    startOwners();
    await settle();
    const ack = deferred<SettingsUpdateResult>();
    daemon.update.mockReturnValueOnce(ack.promise);
    store.dispatch(intent());
    await settle();
    expect(rendered()).toEqual(initialRendered);
    expect(request.mock.calls).toEqual([
      ['settings.list'],
      ...(kind === 'effort' ? [] : [['settings.list']]),
      ['settings.update', { changes }],
    ]);
    const response = daemon.commit(changes);
    if (order === 'before') {
      store.dispatch(settingsChangesReceived(response.applied, response.revision));
      await settle();
      expect(rendered()).toEqual(received);
    }
    ack.resolve(response);
    await settle();
    expect(rendered()).toEqual(order === 'before' ? received : initialRendered);
    store.dispatch(settingsChangesReceived(response.applied, response.revision));
    await settle();
    expect(rendered()).toEqual(received);
    expect(request).toHaveBeenCalledTimes(kind === 'effort' ? 2 : 3);
  },
);

it('sends every default effort intent and renders only daemon receipts', async () => {
  const daemon = mockDaemon();
  startOwners();
  await settle();
  const ack = deferred<SettingsUpdateResult>();
  daemon.update.mockReturnValueOnce(ack.promise);
  store.dispatch(setDefaultReasoningEffort('medium'));
  store.dispatch(setDefaultReasoningEffort('high'));
  store.dispatch(setDefaultReasoningEffort('low'));
  await settle();
  expect(store.state.model.defaultReasoningEffort).toBe('low');
  expect(daemon.update).toHaveBeenCalledTimes(1);
  ack.resolve(daemon.commit(effortChanges('medium')));
  await settle();
  expect(request.mock.calls).toEqual([
    ['settings.list'],
    ['settings.update', { changes: [{ path: 'model.defaultReasoningEffort', value: 'medium' }] }],
    ['settings.update', { changes: [{ path: 'model.defaultReasoningEffort', value: 'high' }] }],
    ['settings.update', { changes: [{ path: 'model.defaultReasoningEffort', value: 'low' }] }],
  ]);
  expect(store.state.model.defaultReasoningEffort).toBe('low');
  const external = daemon.commit(effortChanges('high'));
  store.dispatch(settingsChangesReceived(external.applied, external.revision));
  await settle();
  expect(store.state.model.defaultReasoningEffort).toBe('high');
});

it('rereads once after rejection and reapplies only the failed setting', async () => {
  const daemon = mockDaemon();
  startOwners();
  await settle();
  daemon.update.mockRejectedValueOnce(
    new BackendError({ code: 'INVALID_PARAMS', rpcCode: -32602, message: 'Rejected' }),
  );
  daemon.commit([
    { path: 'model.defaultProvider', value: 'codex' },
    ...modelChanges({ grok: 'must-not-apply' }),
    ...effortChanges('medium'),
  ]);
  store.dispatch(setDefaultReasoningEffort('high'));
  await settle();
  expect(request.mock.calls).toEqual([
    ['settings.list'],
    ['settings.update', { changes: [{ path: 'model.defaultReasoningEffort', value: 'high' }] }],
    ['settings.list'],
  ]);
  expect(store.state.model.defaultReasoningEffort).toBe('medium');
  expect(store.state.model.defaultProviderId).toBe('grok');
  expect(store.state.model.providerModels.grok).toBe('grok4.5');
});

it.each([
  {
    kind: 'model',
    intent: () => setSelectedModel({ providerId: 'grok', model: 'grok4.5' }),
    changes: modelChanges(initialModels),
  },
  {
    kind: 'provider',
    intent: () => setActiveProvider('grok'),
    changes: [{ path: 'model.defaultProvider', value: 'grok' }],
  },
  {
    kind: 'atomic',
    intent: () => setAtomicDefaultModel({ providerId: 'grok', model: 'grok4.5' }),
    changes: [{ path: 'model.defaultProvider', value: 'grok' }, ...modelChanges(initialModels)],
  },
  { kind: 'effort', intent: () => setDefaultReasoningEffort('low'), changes: effortChanges('low') },
])(
  'sends an unchanged $kind intent once without treating applied [] as failure',
  async ({ kind, intent, changes }) => {
    const daemon = mockDaemon();
    startOwners();
    await settle();
    store.dispatch(intent());
    await settle();
    expect(request.mock.calls).toEqual([
      ['settings.list'],
      ...(kind === 'effort' ? [] : [['settings.list']]),
      ['settings.update', { changes }],
    ]);
    await expect(daemon.update.mock.results[0].value).resolves.toEqual({
      applied: [],
      revision: 7,
    });
    expect(rendered()).toEqual(initialRendered);
  },
);

it('freshly reads the daemon map for every queued pick despite delayed events', async () => {
  const daemon = mockDaemon();
  startOwners();
  await settle();
  daemon.commit(modelChanges({ grok: 'grok4.5', codex: 'external-codex' }));
  const ack = deferred<SettingsUpdateResult>();
  daemon.update.mockReturnValueOnce(ack.promise);
  store.dispatch(setSelectedModel({ providerId: 'grok', model: 'grok-A' }));
  await settle();
  store.dispatch(setSelectedModel({ providerId: 'codex', model: 'codex-B' }));
  store.dispatch(setSelectedModel({ providerId: 'grok', model: 'grok-C' }));
  store.dispatch(setSelectedModel({ providerId: 'grok', model: 'grok-D' }));
  await settle();
  expect(rendered()).toEqual(initialRendered);
  const first = modelChanges({ grok: 'grok-A', codex: 'external-codex' });
  expect(request.mock.calls).toEqual([
    ['settings.list'],
    ['settings.list'],
    ['settings.update', { changes: first }],
  ]);
  ack.resolve(daemon.commit(first));
  await vi.waitFor(() => expect(daemon.update).toHaveBeenCalledTimes(4));
  await settle();
  expect(request.mock.calls).toEqual([
    ['settings.list'],
    ['settings.list'],
    ['settings.update', { changes: first }],
    ['settings.list'],
    ['settings.update', { changes: modelChanges({ grok: 'grok-A', codex: 'codex-B' }) }],
    ['settings.list'],
    ['settings.update', { changes: modelChanges({ grok: 'grok-C', codex: 'codex-B' }) }],
    ['settings.list'],
    ['settings.update', { changes: modelChanges({ grok: 'grok-D', codex: 'codex-B' }) }],
  ]);
  expect(rendered()).toEqual(initialRendered);
  const snapshot = daemon.snapshot();
  store.dispatch(settingsChangesReceived(snapshot.settings, snapshot.revision));
  await settle();
  expect(rendered()).toEqual({ ...initialRendered, models: { grok: 'grok-D', codex: 'codex-B' } });
  expect(request).toHaveBeenCalledTimes(9);
});

it.each(['provider', 'atomic'] as const)(
  'sends every queued %s switch using fresh daemon provider bundles',
  async (kind) => {
    const daemon = mockDaemon();
    startOwners();
    await settle();
    const ack = deferred<SettingsUpdateResult>();
    daemon.update.mockReturnValueOnce(ack.promise);
    const intent = (providerId: string, model: string) =>
      kind === 'atomic'
        ? setAtomicDefaultModel({ providerId, model })
        : setActiveProvider(providerId);
    store.dispatch(intent('codex', 'codex-A'));
    await settle();
    store.dispatch(intent('grok', 'grok-B'));
    store.dispatch(intent('codex', 'codex-C'));
    await settle();
    expect(daemon.update).toHaveBeenCalledTimes(1);
    expect(rendered()).toEqual(initialRendered);
    const first = [
      switchChanges[0],
      ...(kind === 'atomic' ? modelChanges({ grok: 'grok4.5', codex: 'codex-A' }) : []),
      ...switchChanges.slice(1),
    ];
    const savedBundles = [
      ...switchChanges.slice(1, -1),
      {
        path: 'quickActions.providerSettings',
        value: { grok: emptyBackground, codex: emptyBackground },
      },
    ];
    ack.resolve(daemon.commit(first));
    await vi.waitFor(() => expect(daemon.update).toHaveBeenCalledTimes(3));
    await settle();
    expect(request.mock.calls).toEqual([
      ['settings.list'],
      ['settings.list'],
      ['settings.update', { changes: first }],
      ['settings.list'],
      [
        'settings.update',
        {
          changes: [
            { path: 'model.defaultProvider', value: 'grok' },
            ...(kind === 'atomic' ? modelChanges({ grok: 'grok-B', codex: 'codex-A' }) : []),
            ...savedBundles,
          ],
        },
      ],
      ['settings.list'],
      [
        'settings.update',
        {
          changes: [
            { path: 'model.defaultProvider', value: 'codex' },
            ...(kind === 'atomic' ? modelChanges({ grok: 'grok-B', codex: 'codex-C' }) : []),
            ...savedBundles,
          ],
        },
      ],
    ]);
    expect(rendered()).toEqual(initialRendered);
    const snapshot = daemon.snapshot();
    store.dispatch(settingsChangesReceived(snapshot.settings, snapshot.revision));
    await settle();
    expect(rendered()).toEqual({
      ...initialRendered,
      provider: 'codex',
      models: kind === 'atomic' ? { grok: 'grok-B', codex: 'codex-C' } : initialModels,
    });
    expect(request).toHaveBeenCalledTimes(7);
  },
);

it('accepts a delayed unrelated event below the failed-field recovery revision', async () => {
  const daemon = mockDaemon();
  startOwners();
  await settle();
  const delayed = daemon.commit([{ path: 'model.defaultProvider', value: 'codex' }]);
  daemon.commit(effortChanges('medium'));
  daemon.update.mockRejectedValueOnce(new Error('Disconnected'));
  store.dispatch(setDefaultReasoningEffort('high'));
  await settle();
  expect(rendered()).toEqual({ ...initialRendered, effort: 'medium' });
  store.dispatch(settingsChangesReceived(delayed.applied, delayed.revision));
  await settle();
  expect(rendered()).toEqual({ ...initialRendered, provider: 'codex', effort: 'medium' });
  expect(request.mock.calls).toEqual([
    ['settings.list'],
    ['settings.update', { changes: effortChanges('high') }],
    ['settings.list'],
  ]);
});

it.each(
  cases.flatMap((scenario) =>
    ['rejection', 'transport'].map((failure) => ({ ...scenario, failure })),
  ),
)(
  'recovers only failed $kind fields once after $failure, without retrying the write',
  async ({ kind, intent, changes, failure }) => {
    vi.useFakeTimers();
    const daemon = mockDaemon();
    startOwners();
    await settle();
    const ack = deferred<SettingsUpdateResult>();
    daemon.update.mockReturnValueOnce(ack.promise);
    store.dispatch(intent());
    await settle();
    const unrelated =
      kind === 'effort'
        ? [
            { path: 'model.defaultProvider', value: 'auggie' },
            ...modelChanges({ grok: 'external' }),
          ]
        : kind === 'model'
          ? [{ path: 'model.defaultProvider', value: 'auggie' }, ...effortChanges('medium')]
          : effortChanges('medium');
    const external = daemon.commit(unrelated);
    store.dispatch(settingsChangesReceived(external.applied, external.revision));
    await settle();
    const beforeRecovery = rendered();
    const failedPaths = new Set(changes.map(({ path }) => path));
    const recoveryChanges = [
      { path: 'model.defaultProvider', value: 'codex' },
      ...modelChanges({ grok: 'recovered', codex: 'recovered-codex' }),
      ...effortChanges('high'),
    ];
    daemon.commit(recoveryChanges);
    ack.reject(
      failure === 'rejection'
        ? new BackendError({ code: 'INVALID_PARAMS', rpcCode: -32602, message: 'Rejected' })
        : new Error('Disconnected'),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request.mock.calls).toEqual([
      ['settings.list'],
      ...(kind === 'effort' ? [] : [['settings.list']]),
      ['settings.update', { changes }],
      ['settings.list'],
    ]);
    expect(rendered()).toEqual({
      provider: failedPaths.has('model.defaultProvider') ? 'codex' : beforeRecovery.provider,
      models: failedPaths.has('model.providerDefaults')
        ? { grok: 'recovered', codex: 'recovered-codex' }
        : beforeRecovery.models,
      effort: failedPaths.has('model.defaultReasoningEffort') ? 'high' : beforeRecovery.effort,
    });
  },
);

it.each(cases)(
  'ignores a late $kind recovery snapshot after a newer same-field event',
  async ({ kind, intent, changes, received }) => {
    const daemon = mockDaemon();
    startOwners();
    await settle();
    const ack = deferred<SettingsUpdateResult>();
    daemon.update.mockReturnValueOnce(ack.promise);
    store.dispatch(intent());
    await settle();
    const stale = daemon.snapshot();
    const recovery = deferred<ReturnType<typeof daemon.snapshot>>();
    daemon.read.mockReturnValueOnce(recovery.promise);
    ack.reject(new BackendError({ code: 'INVALID_PARAMS', rpcCode: -32602, message: 'Rejected' }));
    await settle();
    expect(daemon.read).toHaveBeenCalledTimes(kind === 'effort' ? 2 : 3);
    const external = daemon.commit(changes);
    store.dispatch(settingsChangesReceived(external.applied, external.revision));
    await settle();
    expect(rendered()).toEqual(received);
    recovery.resolve(stale);
    await settle();
    expect(rendered()).toEqual(received);
    expect(request).toHaveBeenCalledTimes(kind === 'effort' ? 3 : 4);
  },
);

it('discards a read-modify-write snapshot and queued picks when the connection changes', async () => {
  const daemon = mockDaemon();
  startOwners();
  await settle();
  const read = deferred<ReturnType<typeof daemon.snapshot>>();
  daemon.read.mockReturnValueOnce(read.promise);
  store.dispatch(setSelectedModel({ providerId: 'grok', model: 'old-connection-model' }));
  store.dispatch(setActiveProvider('codex'));
  store.dispatch(setAtomicDefaultModel({ providerId: 'codex', model: 'old-connection-atomic' }));
  await settle();
  expect(request.mock.calls).toEqual([['settings.list'], ['settings.list']]);
  store.dispatch(hostExecutionConnectionChanged('connection-B'));
  read.resolve(daemon.snapshot());
  await settle();
  expect(request.mock.calls).toEqual([['settings.list'], ['settings.list']]);
  expect(rendered()).toEqual({ provider: '', models: {}, effort: '' });
});

it.each(cases)(
  'does not send queued $kind intents to a replacement connection',
  async ({ kind, intent, changes }) => {
    const daemon = mockDaemon();
    startOwners();
    await settle();
    const ack = deferred<SettingsUpdateResult>();
    daemon.update.mockReturnValueOnce(ack.promise);
    store.dispatch(intent());
    await settle();
    store.dispatch(intent());
    store.dispatch(hostExecutionConnectionChanged('connection-B'));
    ack.resolve(daemon.commit(changes));
    await settle();
    expect(request.mock.calls).toEqual([
      ['settings.list'],
      ...(kind === 'effort' ? [] : [['settings.list']]),
      ['settings.update', { changes }],
    ]);
    expect(rendered()).toEqual({ provider: '', models: {}, effort: '' });
  },
);

it('discards a failed-field recovery from a replaced connection', async () => {
  const daemon = mockDaemon();
  startOwners();
  await settle();
  const recovery = deferred<ReturnType<typeof daemon.snapshot>>();
  daemon.read.mockReturnValueOnce(recovery.promise);
  daemon.update.mockRejectedValueOnce(new Error('Disconnected'));
  store.dispatch(setDefaultReasoningEffort('high'));
  await settle();
  expect(daemon.read).toHaveBeenCalledTimes(2);
  store.dispatch(hostExecutionConnectionChanged('connection-B'));
  recovery.resolve(daemon.snapshot());
  await settle();
  expect(rendered()).toEqual({ provider: '', models: {}, effort: '' });
  expect(request).toHaveBeenCalledTimes(3);
});

it('hydrates boot and external events without writing settings back', async () => {
  const daemon = mockDaemon();
  startOwners();
  await settle();
  expect(rendered()).toEqual(initialRendered);
  const external = daemon.commit([
    { path: 'model.defaultProvider', value: 'codex' },
    ...modelChanges({ codex: 'external-model' }),
    ...effortChanges('high'),
  ]);
  store.dispatch(settingsChangesReceived(external.applied, external.revision));
  await settle();
  expect(rendered()).toEqual({
    provider: 'codex',
    models: { codex: 'external-model' },
    effort: 'high',
  });
  expect(request.mock.calls).toEqual([['settings.list']]);
});
