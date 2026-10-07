import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), reset: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: mocks } }));
import {
  clearProviderTokenDrafts,
  stageProviderToken,
  takeProviderToken,
} from '$features/settings/provider-token-drafts';
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import {
  initialState,
  providerSettingsReducer,
  providerSettingsSessionOpened,
  providerSettingsSessionClosed,
  providerTokenWriteRequested,
  providerTokenReadRequested,
} from '../provider-settings-slice';
import { providerAccessTokenSaga } from './provider-access-token-saga';
const path = 'providers.codex.accessToken';
const settle = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
function setup(supported = true) {
  let state = {
    providerSettings: initialState,
    providerCatalog: {
      providers: createCollection('id', [
        {
          id: 'codex',
          ...(supported ? { accessToken: { kind: 'codexAccessToken', settingPath: path } } : {}),
        },
      ]),
    },
  };
  const actions: unknown[] = [];
  const channel = stdChannel();
  const dispatch = (action: any) => {
    actions.push(action);
    state = { ...state, providerSettings: providerSettingsReducer(state.providerSettings, action) };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, providerAccessTokenSaga);
  dispatch(providerSettingsSessionOpened('session'));
  dispatch(providerTokenReadRequested('codex'));
  return {
    task,
    dispatch,
    actions,
    state: () => state.providerSettings,
    token: () => state.providerSettings.accessTokens.codex,
  };
}
let task: Task;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ path, sensitive: true, value: null });
  mocks.update.mockResolvedValue([{ path, value: '********' }]);
  mocks.reset.mockResolvedValue({ path, value: null });
});
afterEach(() => {
  task?.cancel();
  clearProviderTokenDrafts();
});
describe('provider access tokens saga', () => {
  it('saves, replaces, and removes without secrets in state or actions', async () => {
    const h = setup();
    task = h.task;
    await settle();
    expect(h.token().configured).toBe(false);
    for (const id of ['save', 'replace']) {
      stageProviderToken(id, 'session', `synthetic-${id}`);
      h.dispatch(providerTokenWriteRequested('codex', 'save', { id, sessionId: 'session' }));
      await settle();
      expect(h.token().configured).toBe(true);
      expect(mocks.update).toHaveBeenLastCalledWith([{ path, value: `synthetic-${id}` }]);
      expect(JSON.stringify([h.state(), h.actions])).not.toContain(`synthetic-${id}`);
      expect(takeProviderToken(id, 'session')).toBeUndefined();
    }
    h.dispatch(
      providerTokenWriteRequested('codex', 'remove', { id: 'remove', sessionId: 'session' }),
    );
    await settle();
    expect(h.token().configured).toBe(false);
    expect(mocks.reset).toHaveBeenCalledWith(path);
  });
  it('does not allow unsupported providers to read or write a token', async () => {
    const h = setup(false);
    task = h.task;
    await settle();
    stageProviderToken('save', 'session', 'synthetic');
    h.dispatch(providerTokenWriteRequested('codex', 'save', { id: 'save', sessionId: 'session' }));
    await settle();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(takeProviderToken('save', 'session')).toBeUndefined();
  });
  it('preserves configured state on a failed replace without exposing the backend error', async () => {
    mocks.get.mockResolvedValue({ path, sensitive: true, value: '********' });
    mocks.update.mockRejectedValue(new Error('rejected secret-token'));
    const h = setup();
    task = h.task;
    await settle();
    stageProviderToken('replace', 'session', 'secret-token');
    h.dispatch(
      providerTokenWriteRequested('codex', 'save', { id: 'replace', sessionId: 'session' }),
    );
    await settle();
    expect(h.token()).toMatchObject({
      configured: true,
      busy: false,
      failed: true,
      status: 'ready',
    });
    expect(JSON.stringify([h.state(), h.actions])).not.toContain('secret-token');
  });
  it('rejects overlapping writes and stale read completions', async () => {
    const pending = deferred<{ path: string; sensitive: boolean; value: null }>();
    const h = setup();
    task = h.task;
    await settle();
    mocks.get.mockReturnValueOnce(pending.promise);
    h.dispatch(providerTokenReadRequested('codex'));
    // Newer retry wins over the older in-flight read.
    mocks.get.mockResolvedValueOnce({ path, sensitive: true, value: '********' });
    h.dispatch(providerTokenReadRequested('codex'));
    await settle();
    pending.resolve({ path, sensitive: true, value: null });
    await settle();
    expect(h.token().configured).toBe(true);
    const write = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(write.promise);
    stageProviderToken('first', 'session', 'first-fixture');
    h.dispatch(providerTokenWriteRequested('codex', 'save', { id: 'first', sessionId: 'session' }));
    stageProviderToken('second', 'session', 'second-fixture');
    h.dispatch(
      providerTokenWriteRequested('codex', 'save', { id: 'second', sessionId: 'session' }),
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(takeProviderToken('second', 'session')).toBeUndefined();
    write.resolve([{ path, value: '********' }]);
    await settle();
    expect(h.token().busy).toBe(false);
  });
  it('forgets pending drafts when closed and prevents post-close writes', async () => {
    const h = setup();
    task = h.task;
    await settle();
    stageProviderToken('save', 'session', 'abandoned');
    h.dispatch(providerSettingsSessionClosed('session'));
    expect(takeProviderToken('save', 'session')).toBeUndefined();
    h.dispatch(providerTokenWriteRequested('codex', 'save', { id: 'save', sessionId: 'session' }));
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('ignores old backend completions and clears drafts when the connection changes', async () => {
    const write = deferred<unknown[]>();
    mocks.update.mockReturnValueOnce(write.promise);
    const h = setup();
    task = h.task;
    await settle();
    stageProviderToken('save', 'session', 'old-host-token');
    h.dispatch(providerTokenWriteRequested('codex', 'save', { id: 'save', sessionId: 'session' }));
    stageProviderToken('queued', 'session', 'queued-host-token');
    h.dispatch(hostExecutionConnectionChanged('new-host'));
    write.resolve([{ path, value: '********' }]);
    await settle();
    expect(h.state().accessTokens).toEqual({});
    expect(takeProviderToken('queued', 'session')).toBeUndefined();
  });
});
