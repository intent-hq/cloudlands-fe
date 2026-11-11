import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
const mocks = vi.hoisted(() => ({ update: vi.fn(), error: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { updateSnapshot: mocks.update } } }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.error } }));
import {
  fastModeHydrationStarted,
  hydrateRemoteMachineSignIn,
  initialState,
  providerSettingsReducer,
  remoteMachineSignInSupportReceived,
  setRemoteMachineSignIn,
} from '../provider-settings-slice';
import { selectRemoteMachineSignInValues } from '../provider-settings-selectors';
import { providerRemoteMachineSignInSaga } from './provider-remote-machine-sign-in-saga';

const PATH = 'providers.remoteMachineSignIn';
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

function setup() {
  let current = {
    providerSettings: providerSettingsReducer(
      initialState,
      remoteMachineSignInSupportReceived(true),
    ),
  };
  const channel = stdChannel();
  const dispatch = (action: any) => {
    current = { providerSettings: providerSettingsReducer(current.providerSettings, action) };
    channel.put(action);
  };
  const task = runSaga(
    { channel, dispatch, getState: () => current },
    providerRemoteMachineSignInSaga,
  );
  return {
    dispatch,
    task,
    state: () => current.providerSettings.remoteMachineSignIn,
    values: () => selectRemoteMachineSignInValues.select(current as never),
  };
}

let task: Task;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockImplementation(async (changes) => ({ applied: changes, revision: 5 }));
});
afterEach(() => task?.cancel());

describe('machine sign-in writes (providers.remoteMachineSignIn)', () => {
  it('writes the whole map, keeping the other provider’s entry', async () => {
    const h = setup();
    task = h.task;
    h.dispatch(hydrateRemoteMachineSignIn({ codex: false }, 1));
    h.dispatch(setRemoteMachineSignIn('claude-code', false));
    await settle();
    expect(mocks.update).toHaveBeenCalledWith([
      { path: PATH, value: { codex: false, 'claude-code': false } },
    ]);
    expect(h.values()).toEqual({ codex: false, 'claude-code': false });
    expect(h.state().pending).toEqual({});
  });

  it('serializes quick clicks, each merged over the latest confirmed map', async () => {
    const first = deferred<{ applied: unknown[]; revision: number }>();
    mocks.update
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (changes) => ({ applied: changes, revision: 3 }));
    const h = setup();
    task = h.task;
    h.dispatch(setRemoteMachineSignIn('codex', false));
    h.dispatch(setRemoteMachineSignIn('claude-code', false));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    first.resolve({ applied: [{ path: PATH, value: { codex: false } }], revision: 2 });
    await settle();
    expect(mocks.update.mock.calls.map(([changes]) => changes[0].value)).toEqual([
      { codex: false },
      { codex: false, 'claude-code': false },
    ]);
  });

  it('a rejected write toasts and falls back to the confirmed value', async () => {
    mocks.update.mockRejectedValueOnce(new Error('rejected'));
    const h = setup();
    task = h.task;
    h.dispatch(hydrateRemoteMachineSignIn({ codex: true }, 1));
    h.dispatch(setRemoteMachineSignIn('codex', false));
    expect(h.values().codex).toBe(false);
    await settle();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(h.state().pending).toEqual({});
    expect(h.values().codex).toBe(true);
  });

  it('ignores an older revision and resets on a new settings hydration', () => {
    const h = setup();
    task = h.task;
    h.dispatch(hydrateRemoteMachineSignIn({ codex: false }, 4));
    h.dispatch(hydrateRemoteMachineSignIn({ codex: true }, 3));
    expect(h.values()).toEqual({ codex: false });
    h.dispatch(fastModeHydrationStarted());
    expect(h.state().supported).toBe(false);
    expect(h.values()).toEqual({});
  });

  it('records no click while the backend lacks the setting', () => {
    const h = setup();
    task = h.task;
    h.dispatch(remoteMachineSignInSupportReceived(false));
    h.dispatch(setRemoteMachineSignIn('codex', false));
    expect(h.state().pending).toEqual({});
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
