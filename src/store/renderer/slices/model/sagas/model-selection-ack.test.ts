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
import type { AppliedSettingChange } from '$lib/client/app-client';
import { store } from '$store/renderer/store';
import { setAtomicDefaultModel } from '../../provider-settings/provider-settings-slice';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import { settingsHydrationSaga } from '../../settings-events/sagas/settings-hydration-saga';
import { persistSelectedModelsWorker } from './model-selection-saga';

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

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

const selection = (provider = 'grok', model = 'grok4.5'): AppliedSettingChange[] => [
  { path: 'model.defaultProvider', value: provider },
  { path: 'model.providerDefaults', value: { grok: model, codex: 'gpt-6-astra' } },
];

function startHydration() {
  dispose = store.init();
  const channel = stdChannel();
  const dispatch = (action: { type: string }) => {
    store.dispatch(action);
    channel.put(action);
    return action;
  };
  const environment = { channel, dispatch, getState: () => store.state };
  tasks.push(runSaga(environment, settingsHydrationSaga));
  return environment;
}

it.each([
  { name: 'no changes', initial: selection(), applied: [] },
  {
    name: 'only provider changed',
    initial: selection('codex'),
    applied: [selection()[0]],
  },
  {
    name: 'only model changed',
    initial: selection('grok', 'grok-old'),
    applied: [selection()[1]],
  },
])(
  'retires acknowledged picks with $name and accepts later authoritative changes',
  async ({ initial, applied }) => {
    request.mockResolvedValueOnce({ settings: initial, revision: 7 });
    const environment = startHydration();
    await settle();
    environment.dispatch(setAtomicDefaultModel({ providerId: 'grok', model: 'grok4.5' }));
    request.mockResolvedValueOnce({ applied, revision: 8 });

    expect(
      await runSaga(
        environment,
        persistSelectedModelsWorker,
        { grok: 'grok4.5' },
        'grok',
      ).toPromise(),
    ).toBe('persisted');
    await settle();

    expect(request).toHaveBeenLastCalledWith('settings.update', { changes: selection() });
    expect(store.state.model.pendingDefaultProviderId).toBeNull();
    expect(store.state.model.pendingProviderModels).toEqual({});
    environment.dispatch(settingsChangesReceived(selection('codex', 'stale'), 7));
    await settle();
    expect(store.state.model.defaultProviderId).toBe('grok');
    expect(store.state.model.providerModels.grok).toBe('grok4.5');
    environment.dispatch(settingsChangesReceived(selection('codex', 'grok-next'), 9));
    await settle();
    expect(store.state.model.defaultProviderId).toBe('codex');
    expect(store.state.model.providerModels.grok).toBe('grok-next');
  },
);

it('keeps newer provider and model picks pending when an older no-op save settles', async () => {
  request.mockResolvedValueOnce({ settings: selection(), revision: 7 });
  const environment = startHydration();
  await settle();
  environment.dispatch(setAtomicDefaultModel({ providerId: 'grok', model: 'grok4.5' }));
  let acknowledge!: (response: unknown) => void;
  request.mockReturnValueOnce(new Promise((resolve) => (acknowledge = resolve)));
  const save = runSaga(environment, persistSelectedModelsWorker, { grok: 'grok4.5' }, 'grok');
  environment.dispatch(setAtomicDefaultModel({ providerId: 'grok', model: 'grok-newer' }));
  environment.dispatch(setAtomicDefaultModel({ providerId: 'codex', model: 'gpt-newer' }));
  acknowledge({ applied: [], revision: 8 });
  await save.toPromise();
  await settle();

  expect(store.state.model.pendingDefaultProviderId).toBe('codex');
  expect(store.state.model.pendingProviderModels).toEqual({
    grok: 'grok-newer',
    codex: 'gpt-newer',
  });
  environment.dispatch(settingsChangesReceived(selection(), 8));
  await settle();
  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(store.state.model.providerModels).toEqual({ grok: 'grok-newer', codex: 'gpt-newer' });
});

it('orders a no-op acknowledgement after an older in-flight boot snapshot', async () => {
  let finishBoot!: (response: unknown) => void;
  request.mockReturnValueOnce(new Promise((resolve) => (finishBoot = resolve)));
  const environment = startHydration();
  environment.dispatch(setAtomicDefaultModel({ providerId: 'grok', model: 'grok4.5' }));
  request.mockResolvedValueOnce({ applied: [], revision: 8 });
  await runSaga(environment, persistSelectedModelsWorker, { grok: 'grok4.5' }, 'grok').toPromise();
  finishBoot({ settings: selection('codex', 'grok-old'), revision: 7 });
  await settle();

  expect(store.state.model.defaultProviderId).toBe('grok');
  expect(store.state.model.providerModels.grok).toBe('grok4.5');
  expect(store.state.model.pendingDefaultProviderId).toBeNull();
  expect(store.state.model.pendingProviderModels).toEqual({});
  environment.dispatch(settingsChangesReceived(selection('codex', 'grok-next'), 9));
  await settle();
  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(store.state.model.providerModels.grok).toBe('grok-next');
});

it('ignores an older save response after newer authoritative settings arrive', async () => {
  request.mockResolvedValueOnce({ settings: selection(), revision: 7 });
  const environment = startHydration();
  await settle();
  environment.dispatch(setAtomicDefaultModel({ providerId: 'grok', model: 'grok4.5' }));
  let acknowledge!: (response: unknown) => void;
  request.mockReturnValueOnce(new Promise((resolve) => (acknowledge = resolve)));
  const save = runSaga(environment, persistSelectedModelsWorker, { grok: 'grok4.5' }, 'grok');
  environment.dispatch(settingsChangesReceived(selection(), 8));
  environment.dispatch(settingsChangesReceived(selection('codex', 'grok-next'), 9));
  await settle();
  acknowledge({ applied: [], revision: 8 });
  await save.toPromise();
  await settle();

  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(store.state.model.providerModels.grok).toBe('grok-next');
  expect(store.state.model.pendingDefaultProviderId).toBeNull();
  expect(store.state.model.pendingProviderModels).toEqual({});
});
