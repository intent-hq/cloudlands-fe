import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection, getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { initialState as modelInitialState, modelReducer } from '../../model/model-slice';
import { initialState as availabilityInitialState } from '../../agent-availability/agent-availability-slice';
import {
  initialState,
  providerSettingsReducer,
  providerSettingsSessionOpened,
  providerSettingsSessionClosed,
  providerPathSaveRequested,
  providerEnablementSeedRequested,
  setProviderEnabled,
  setActiveProvider,
  setAtomicDefaultModel,
} from '../provider-settings-slice';
import { providerSettingsSaga } from './provider-settings-saga';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { get: mocks.get, update: mocks.update } },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: mocks.success, error: mocks.error },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const tasks: Task[] = [];
function harness() {
  let current = {
    providerSettings: initialState,
    model: modelInitialState,
    agentAvailability: availabilityInitialState,
    providerCatalog: { providers: createCollection('id', [{ id: 'codex', canBeDisabled: true }]) },
    connections: { windowBackendId: 'local' },
  };
  const channel = stdChannel();
  const send = (action: Parameters<typeof providerSettingsReducer>[1]) => {
    current = {
      ...current,
      providerSettings: providerSettingsReducer(current.providerSettings, action),
      model: modelReducer(current.model, action),
    };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch: send, getState: () => current }, providerSettingsSaga);
  tasks.push(task);
  send(providerSettingsSessionOpened('panel'));
  return {
    send,
    task,
    state: () => current,
    request: (id: string) => getItem(current.providerSettings.requests, id),
  };
}
const context = (id: string) => ({ id, sessionId: 'panel' });
const invalid = () =>
  new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ value: {} });
  mocks.update.mockResolvedValue([]);
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

describe('provider settings ordered ownership', () => {
  it('does not let an old repeated-value rejection retire newer enablement intent', async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h = harness();
    h.send(setProviderEnabled({ providerId: 'codex', enabled: true }, context('old')));
    h.send(setProviderEnabled({ providerId: 'codex', enabled: true }, context('new')));
    first.reject(invalid());
    await settle();
    expect(h.state().providerSettings.pendingEnablementOverrides).toEqual({ codex: true });
    expect(h.request('old')?.status).toBe('failure');
    expect(h.request('new')?.status).toBe('pending');
    second.reject(invalid());
    await settle();
    expect(h.state().providerSettings.pendingEnablementOverrides).toEqual({});
    expect(h.request('new')?.status).toBe('failure');
  });

  it('serializes atomic provider/model batches with provider-only defaults in both directions', async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h = harness();
    h.send(setAtomicDefaultModel({ providerId: 'codex', model: 'first' }));
    h.send(setActiveProvider('grok', context('default')));
    h.send(setAtomicDefaultModel({ providerId: 'codex', model: 'last' }));
    await settle();
    expect(mocks.update.mock.calls).toEqual([
      [
        [
          { path: 'model.defaultProvider', value: 'codex' },
          { path: 'model.providerDefaults', value: { codex: 'first' } },
        ],
      ],
    ]);
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith([
      { path: 'model.defaultProvider', value: 'grok' },
    ]);
    second.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenLastCalledWith([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'last' } },
    ]);
    expect(h.request('default')?.status).toBe('cancelled');
    expect(h.state().model.defaultProviderId).toBe('codex');
  });

  it('reads each full paths map only after the preceding provider write acknowledges', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    mocks.get
      .mockResolvedValueOnce({ value: { pi: '/keep' } })
      .mockResolvedValueOnce({ value: { pi: '/keep', codex: '/one' } });
    const h = harness();
    h.send(providerPathSaveRequested('codex', '/one', context('one')));
    h.send(providerPathSaveRequested('grok', '/two', context('two')));
    await settle();
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('providers.paths');
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith([
      { path: 'providers.paths', value: { pi: '/keep', codex: '/one' } },
    ]);
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenLastCalledWith([
      { path: 'providers.paths', value: { pi: '/keep', codex: '/one', grok: '/two' } },
    ]);
    expect(h.request('one')?.status).toBe('success');
    expect(h.request('two')?.status).toBe('success');
    expect(h.state().providerSettings.paths.configured).toEqual({ codex: '/one', grok: '/two' });
  });

  it('settles in-flight and queued requests on teardown, ignoring late responses', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = harness();
    h.send(providerPathSaveRequested('codex', '/one', context('one')));
    h.send(providerPathSaveRequested('grok', '/two', context('two')));
    await settle();
    h.task.cancel();
    await h.task.toPromise();
    expect(h.request('one')?.status).toBe('cancelled');
    expect(h.request('two')?.status).toBe('cancelled');
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(h.state().providerSettings.paths.configured).toEqual({});
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('finishes accepted persistence after panel close without recreating its requests or notifications', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = harness();
    h.send(providerPathSaveRequested('codex', '/one', context('one')));
    await settle();
    h.send(providerSettingsSessionClosed('panel'));
    first.resolve([]);
    await settle();
    expect(h.request('one')).toBeUndefined();
    expect(h.state().providerSettings.paths.configured.codex).toBe('/one');
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('settles a failed path read without writing, and permits a later retry', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    const h = harness();
    h.send(providerPathSaveRequested('codex', '/one', context('one')));
    await settle();
    expect(h.request('one')?.status).toBe('failure');
    expect(mocks.update).not.toHaveBeenCalled();
    h.send(providerPathSaveRequested('codex', '/two', context('two')));
    await settle();
    expect(h.request('two')?.status).toBe('success');
  });

  it('seeds only after acknowledgement and preserves a newer explicit false', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = harness();
    h.send(providerEnablementSeedRequested({ codex: true }));
    await settle();
    expect(h.state().providerSettings.enabledProviders).toEqual({});
    h.send(setProviderEnabled({ providerId: 'codex', enabled: false }));
    first.resolve([]);
    await settle();
    expect(h.state().providerSettings.enabledProviders).toEqual({ codex: false });
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'providers.enabled', value: { codex: true } }]],
      [[{ path: 'providers.enabled', value: { codex: false } }]],
    ]);
  });

  it('rechecks live enablement and backend identity before writing a queued seed', async () => {
    const first = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = harness();
    h.send(setActiveProvider('codex'));
    h.send(providerEnablementSeedRequested({ codex: true }));
    h.state().connections.windowBackendId = 'remote';
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(h.state().providerSettings.enabledProviders).toEqual({});
    h.state().connections.windowBackendId = 'local';
    h.send(setProviderEnabled({ providerId: 'codex', enabled: false }));
    h.send(providerEnablementSeedRequested({ codex: true }));
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(h.state().providerSettings.enabledProviders.codex).toBe(false);
  });
});
