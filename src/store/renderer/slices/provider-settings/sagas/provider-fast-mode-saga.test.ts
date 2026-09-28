import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
const mocks = vi.hoisted(() => ({ update: vi.fn(), error: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { updateSnapshot: mocks.update } } }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.error } }));
import {
  fastModeHydrationStarted,
  fastModeSupportReceived,
  hydrateProviderFastMode,
  initialState,
  providerSettingsReducer,
  setProviderFastMode,
} from '../provider-settings-slice';
import { selectProviderFastModeValues } from '../provider-settings-selectors';
import { providerFastModeSaga } from './provider-fast-mode-saga';
import { BackendError } from '$lib/client/live/backend-transport-types';

const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const response = (value: Record<string, boolean>, revision = 2) => ({
  applied: [{ path: 'providers.fastMode', value }],
  revision,
});

function setup() {
  let current = {
    providerSettings: providerSettingsReducer(initialState, fastModeSupportReceived(true)),
    providerCatalog: {
      providers: createCollection('id', [
        { id: 'claude-code', supportsFastMode: true },
        { id: 'codex', supportsFastMode: true },
        { id: 'auggie', supportsFastMode: false },
      ]),
    },
  };
  const channel = stdChannel();
  const dispatch = (action: any) => {
    current = {
      ...current,
      providerSettings: providerSettingsReducer(current.providerSettings, action),
    };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => current }, providerFastModeSaga);
  return {
    dispatch,
    task,
    state: () => current.providerSettings.fastMode,
    values: () => selectProviderFastModeValues.select(current as never),
  };
}
let task: Task;
beforeEach(() => vi.clearAllMocks());
afterEach(() => task?.cancel());
describe('Fast mode serialized daemon writes', () => {
  it('preserves rapid on/off and cross-provider changes behind a slow write', async () => {
    const first = deferred<ReturnType<typeof response>>();
    mocks.update
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (changes) => ({ applied: changes, revision: 3 }));
    const h = setup();
    task = h.task;
    h.dispatch(setProviderFastMode('claude-code', true));
    h.dispatch(setProviderFastMode('codex', true));
    h.dispatch(setProviderFastMode('claude-code', false));
    expect(h.values()).toEqual({ 'claude-code': false, codex: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    first.resolve(response({ 'claude-code': true }));
    await settle();
    expect(mocks.update.mock.calls.map(([changes]) => changes[0].value)).toEqual([
      { 'claude-code': true },
      { 'claude-code': true, codex: true },
      { 'claude-code': false, codex: true },
    ]);
    expect(h.values()).toEqual({ 'claude-code': false, codex: true });
    expect(h.state().pending).toEqual({});
  });
  it('rolls a rejected write back immediately and never persists it through another provider', async () => {
    const first = deferred<ReturnType<typeof response>>();
    mocks.update
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (changes) => ({ applied: changes, revision: 3 }));
    const h = setup();
    task = h.task;
    h.dispatch(hydrateProviderFastMode({ 'claude-code': false, codex: false }, 1));
    h.dispatch(setProviderFastMode('claude-code', true));
    h.dispatch(setProviderFastMode('codex', true));
    first.reject(new BackendError({ message: 'invalid fast mode', code: -32602 }));
    await settle();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[1][0][0].value).toEqual({ 'claude-code': false, codex: true });
    expect(h.values()).toEqual({ 'claude-code': false, codex: true });
    h.dispatch(hydrateProviderFastMode({ codex: false }, 4));
    expect(h.values()).toEqual({ codex: false });
  });
  it('does not clear newer intent on rejection or let an older acknowledgement replace a daemon event', async () => {
    const first = deferred<ReturnType<typeof response>>();
    const second = deferred<ReturnType<typeof response>>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h = setup();
    task = h.task;
    h.dispatch(setProviderFastMode('codex', true));
    h.dispatch(setProviderFastMode('codex', false));
    first.reject(new Error('transport failure'));
    await settle();
    expect(h.values().codex).toBe(false);
    expect(h.state().pending.codex.enabled).toBe(false);
    h.dispatch(hydrateProviderFastMode({ codex: true }, 10));
    second.resolve(response({ codex: false }, 9));
    await settle();
    expect(h.values().codex).toBe(true);
  });
  it('abandons old connection writes and queued clicks when rehydration starts', async () => {
    const first = deferred<ReturnType<typeof response>>();
    mocks.update.mockReturnValueOnce(first.promise);
    const h = setup();
    task = h.task;
    h.dispatch(setProviderFastMode('codex', true));
    h.dispatch(setProviderFastMode('claude-code', true));
    h.dispatch(fastModeHydrationStarted());
    h.dispatch(hydrateProviderFastMode({ codex: false }, 1));
    first.resolve(response({ codex: true }, 20));
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(h.values()).toEqual({ codex: false });
    expect(h.state().supported).toBe(false);
  });
  it('does not write an unsupported provider or an omitted setting', async () => {
    const h = setup();
    task = h.task;
    h.dispatch(setProviderFastMode('auggie', true));
    h.dispatch(fastModeHydrationStarted());
    h.dispatch(setProviderFastMode('codex', true));
    await settle();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
