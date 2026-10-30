import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mocks.update },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.notifyError, info: vi.fn() },
}));

import { takeEvery } from 'typed-redux-saga';
import type { StoreState } from '../../../types';
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
} from './workspace-auto-archive-saga';

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function served(id: string, disabled: boolean) {
  return { ok: true, data: labelWorkspace(id, disabled ? { autoArchiveDisabled: true } : {}) };
}

function* root() {
  yield* takeEvery(setWorkspaceAutoArchiveDisabled, setWorkspaceAutoArchiveDisabledWorker);
}

function start(initial: StoreState) {
  let state = initial;
  const channel = stdChannel();
  const task = runSaga(
    {
      channel,
      dispatch: (action: { type: string }) => {
        state = reduceWorkspaceLabelsState(state, action);
        channel.put(action);
      },
      getState: () => state,
    },
    root,
  );
  return {
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
    },
  };
}

const ownerState = (workspace = labelWorkspace('ws-1')) =>
  workspaceLabelsState({ workspaces: [workspace], autoArchiveOptOut: true });

beforeEach(() => {
  vi.clearAllMocks();
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
    await run.stop();
  });

  it('rolls back a thrown call with the generic error toast', async () => {
    const run = start(ownerState(labelWorkspace('ws-1', { autoArchiveDisabled: true })));
    mocks.update.mockRejectedValueOnce(new Error('offline'));

    run.put(setWorkspaceAutoArchiveDisabled('ws-1', false));
    await settle();

    expect(run.flag('ws-1')).toBe(true);
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
