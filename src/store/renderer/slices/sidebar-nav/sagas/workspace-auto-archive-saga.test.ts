import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  notifyError: vi.fn(),
  transport: {},
}));
vi.mock('$lib/client/live/backend-transport-factory', () => ({
  resolveBackendTransport: () => mocks.transport,
}));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mocks.update },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.notifyError, info: vi.fn() },
}));

import { fork, takeEvery } from 'typed-redux-saga';
import type { StoreState } from '../../../types';
import { store } from '../../../store';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  labelWorkspace,
  reduceWorkspaceLabelsState,
  workspaceLabelsState,
} from '../../../../../test/fixtures/workspace-labels-state';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { setWorkspaceAutoArchiveDisabled } from '../sidebar-nav-slice';
import {
  resetWorkspaceAutoArchiveWritesForTest,
  setWorkspaceAutoArchiveDisabledWorker,
  watchAuthoritativeAutoArchiveDisabled,
} from './workspace-auto-archive-saga';
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

function served(id: string, disabled: boolean) {
  return { ok: true, data: labelWorkspace(id, disabled ? { autoArchiveDisabled: true } : {}) };
}

function* root() {
  yield* fork(watchAuthoritativeAutoArchiveDisabled);
  yield* takeEvery(setWorkspaceAutoArchiveDisabled, setWorkspaceAutoArchiveDisabledWorker);
}

/** An update this saga did not dispatch (another client's workspace:updated, a list refresh). */
const remote = (id: string, autoArchiveDisabled: boolean | undefined) =>
  bulkUpdateWorkspaceEntities([updateWorkspaceEntity(id, { autoArchiveDisabled })]);

function start(initial: StoreState) {
  const dispose = store.init(initial);
  let state = initial;
  let afterDispatch: (() => void) | undefined;
  const channel = stdChannel();
  const task = runSaga(
    {
      channel,
      dispatch: (action: { type: string }) => {
        state = reduceWorkspaceLabelsState(state, action);
        channel.put(action);
        afterDispatch?.();
      },
      getState: () => state,
    },
    root,
  );
  return {
    get state() {
      return state;
    },
    set state(next: StoreState) {
      state = next;
    },
    set afterDispatch(callback: (() => void) | undefined) {
      afterDispatch = callback;
    },
    put(action: { type: string }) {
      state = reduceWorkspaceLabelsState(state, action);
      channel.put(action);
    },
    flag(id: string) {
      return selectWorkspaceById.select(state, id)?.autoArchiveDisabled;
    },
    async stop() {
      task.cancel();
      await task.toPromise();
      dispose();
    },
  };
}

const ownerState = (workspace = labelWorkspace('ws-1')) =>
  workspaceLabelsState({ workspaces: [workspace], autoArchiveOptOut: true });

function readmitted(state: StoreState, disabled: boolean): StoreState {
  const next = ownerState(labelWorkspace('ws-1', { autoArchiveDisabled: disabled || undefined }));
  next.principal = { ...next.principal, invalidation: state.principal.invalidation + 1 };
  next.workspace = {
    ...next.workspace,
    capabilityContext: selectPrincipalActionContext.select(next),
  };
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transport = {};
  resetWorkspaceAutoArchiveWritesForTest();
});

describe('setWorkspaceAutoArchiveDisabled', () => {
  it('turns the opt-out on and off through workspace.update', async () => {
    const run = start(ownerState());

    mocks.update.mockResolvedValueOnce(served('ws-1', true));
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    expect(run.flag('ws-1')).toBe(true);
    await settle();
    expect(run.flag('ws-1')).toBe(true);

    mocks.update.mockResolvedValueOnce(served('ws-1', false));
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();
    expect(run.flag('ws-1')).toBeUndefined();

    expect(mocks.update.mock.calls).toEqual([
      [{ id: 'ws-1', autoArchiveDisabled: true }],
      [{ id: 'ws-1', autoArchiveDisabled: false }],
    ]);
    expect(mocks.notifyError).not.toHaveBeenCalled();

    // Retiring admission during the optimistic put must prevent the actual RPC.
    mocks.update.mockClear();
    run.afterDispatch = () => {
      run.afterDispatch = undefined;
      run.state = readmitted(run.state, true);
    };
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    await settle();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(run.flag('ws-1')).toBe(true);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    await run.stop();
  });

  it('skips the call when the value is unchanged', async () => {
    const run = start(ownerState(labelWorkspace('ws-1', { autoArchiveDisabled: true })));
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    await settle();
    expect(mocks.update).not.toHaveBeenCalled();
    await run.stop();
  });

  it('applies right away and rolls back with a toast when the call fails', async () => {
    const run = start(ownerState());
    const reply = deferred<unknown>();
    mocks.update.mockReturnValueOnce(reply.promise);

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    await settle();
    expect(run.flag('ws-1')).toBe(true);

    reply.resolve({ ok: false, error: 'forbidden' });
    await settle();
    expect(run.flag('ws-1')).toBeUndefined();
    expect(mocks.notifyError).toHaveBeenCalledWith('forbidden');

    // A retired failure cannot roll back a fresh row showing the same value.
    const retired = deferred<unknown>();
    mocks.update.mockReturnValueOnce(retired.promise);
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    await settle();
    run.state = readmitted(run.state, true);
    retired.resolve({ ok: false, error: 'access changed' });
    await settle();
    expect(run.flag('ws-1')).toBe(true);
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);

    // A retired success must not change the replacement owner's rollback target.
    const oldReply = deferred<unknown>();
    const currentReply = deferred<unknown>();
    mocks.update.mockReturnValueOnce(oldReply.promise).mockReturnValueOnce(currentReply.promise);
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();
    run.state = readmitted(run.state, true);
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();
    oldReply.resolve(served('ws-1', false));
    await settle();
    expect(run.flag('ws-1')).toBeUndefined();
    currentReply.resolve({ ok: false, error: 'current refusal' });
    await settle();
    expect(run.flag('ws-1')).toBe(true);
    expect(mocks.notifyError).toHaveBeenCalledTimes(2);
    await run.stop();
  });

  it('rolls back a thrown call with the generic error toast', async () => {
    const run = start(ownerState(labelWorkspace('ws-1', { autoArchiveDisabled: true })));
    mocks.update.mockRejectedValueOnce(new Error('offline'));

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();

    expect(run.flag('ws-1')).toBe(true);
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);

    const retired = deferred<unknown>();
    mocks.update.mockReturnValueOnce(retired.promise);
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();
    // Replacing the transport retires a write even before a new admission is published.
    mocks.transport = {};
    retired.reject(new Error('old transport disconnected'));
    await settle();
    expect(run.flag('ws-1')).toBeUndefined();
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);
    await run.stop();
  });

  it('rolls a failed later write back to an earlier accepted one', async () => {
    const run = start(ownerState());
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();
    expect(run.flag('ws-1')).toBeUndefined();

    first.resolve(served('ws-1', true));
    await settle();
    second.resolve({ ok: false, error: 'nope' });
    await settle();
    expect(run.flag('ws-1')).toBe(true);
    expect(mocks.notifyError).toHaveBeenCalledWith('nope');
    await run.stop();
  });

  it('keeps a value another client set while our failed write was in flight', async () => {
    const run = start(ownerState());
    const reply = deferred<unknown>();
    mocks.update.mockReturnValueOnce(reply.promise);

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    await settle();
    run.put(remote('ws-1', true));
    reply.resolve({ ok: false, error: 'offline' });
    await settle();

    expect(run.flag('ws-1')).toBe(true);
    expect(mocks.notifyError).toHaveBeenCalledWith('offline');
    await run.stop();
  });

  it('keeps another client turning it off while our failed off-write was in flight', async () => {
    const run = start(ownerState(labelWorkspace('ws-1', { autoArchiveDisabled: true })));
    const reply = deferred<unknown>();
    mocks.update.mockReturnValueOnce(reply.promise);

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();
    // The events bridge applies `changes.autoArchiveDisabled: false` as absent.
    run.put(remote('ws-1', undefined));
    reply.resolve({ ok: false, error: 'offline' });
    await settle();

    expect(run.flag('ws-1')).toBeUndefined();
    await run.stop();
  });

  it('falls back to an authoritative update that arrived between overlapping failed writes', async () => {
    const run = start(ownerState());
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    await settle();
    run.put(remote('ws-1', true));
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();
    first.resolve({ ok: false, error: 'first failed' });
    await settle();
    second.resolve({ ok: false, error: 'second failed' });
    await settle();

    expect(run.flag('ws-1')).toBe(true);
    await run.stop();
  });

  it('re-applies the served value over a stale row that landed during the write', async () => {
    const run = start(ownerState());
    const reply = deferred<unknown>();
    mocks.update.mockReturnValueOnce(reply.promise);

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    await settle();
    run.put(remote('ws-1', undefined));
    expect(run.flag('ws-1')).toBeUndefined();
    reply.resolve(served('ws-1', true));
    await settle();

    expect(run.flag('ws-1')).toBe(true);
    await run.stop();
  });

  it('rolls a failed later write back to the value the daemon served for the earlier one', async () => {
    const run = start(ownerState());
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();
    first.resolve(served('ws-1', false));
    await settle();
    second.resolve({ ok: false, error: 'nope' });
    await settle();

    expect(run.flag('ws-1')).toBeUndefined();
    await run.stop();
  });

  it('a failed earlier write leaves a newer pending write alone', async () => {
    const run = start(ownerState());
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', true));
    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();

    first.resolve({ ok: false, error: 'stale' });
    await settle();
    expect(run.flag('ws-1')).toBeUndefined();
    expect(mocks.notifyError).not.toHaveBeenCalled();

    second.resolve({ ok: false, error: 'also failed' });
    await settle();
    expect(run.flag('ws-1')).toBeUndefined();
    expect(mocks.notifyError).toHaveBeenCalledWith('also failed');
    await run.stop();
  });
});
