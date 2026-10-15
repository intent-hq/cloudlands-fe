import { runSaga, stdChannel } from 'redux-saga';
import { call } from 'typed-redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MutationResult } from '$lib/client/client-types';
import { GitFileStatus, type GitStatus } from '$shared/types';
import { reserveGitMutation, isGitMutationPending } from '../../../utils/worktree-mutation-queue';
import { gitReducer, setGitStatus } from '../git-slice';
import { selectGitStatus } from '../git-selectors';
import { selectGitWriteOperation } from '../git-write-selectors';
import {
  gitWriteReducer,
  gitWriteRequested,
  gitWriteConsumerReleased,
  gitWriteFinished,
  cancelQueuedGitWrite,
} from '../git-write-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { getGitCurrentIndexCommit } from '../git-write-projections';
import { createGitWriteSaga } from './git-write-saga-factory';
import type { GitWriteSagaDependencies } from './git-write-saga-types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type State = { gitWrite: ReturnType<typeof gitWriteReducer>; git: ReturnType<typeof gitReducer> };
type Action = Parameters<typeof gitWriteReducer>[1];
const tasks: ReturnType<typeof runSaga>[] = [];

function start(overrides: Partial<GitWriteSagaDependencies> = {}) {
  const channel = stdChannel();
  let state: State = {
    gitWrite: gitWriteReducer(undefined, { type: 'init' }),
    git: gitReducer(undefined, { type: 'init' }),
  };
  const actions: Action[] = [];
  const execute = vi.fn<() => Promise<MutationResult>>().mockResolvedValue({ success: true });
  const invalidate = vi.fn();
  const publish = vi.fn();
  const reconcile = vi.fn();
  const deps: GitWriteSagaDependencies = {
    selectOperation: selectGitWriteOperation.effect,
    selectStatus: selectGitStatus.effect,
    prepare: function* () {
      return execute;
    },
    invalidate,
    publish: function* () {
      publish();
    },
    reconcile: function* () {
      reconcile();
    },
    unknownError: () => 'unavailable',
    logError: vi.fn(),
    ...overrides,
  };
  const dispatch = (action: Action) => {
    state = {
      gitWrite: gitWriteReducer(state.gitWrite, action),
      git: gitReducer(state.git, action),
    };
    actions.push(action);
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, createGitWriteSaga(deps));
  tasks.push(task);
  return { dispatch, state: () => state, actions, execute, invalidate, publish, reconcile, task };
}

afterEach(() => {
  for (const task of tasks.splice(0)) task.cancel();
});

describe('canonical Git write factory authority', () => {
  it('keeps a host predispatch refusal distinct from dispatched uncertainty', async () => {
    const owner = start();
    owner.execute.mockResolvedValueOnce({
      success: false,
      error: 'Staged selection changed before dispatch',
    });
    const operation = {
      kind: 'commit' as const,
      params: { message: 'Checkpoint', userRequested: true, currentIndex: true as const },
    };
    const refused = gitWriteRequested('commit-preflight', 'first', operation);
    owner.dispatch(refused);
    await expect(refused.promise).resolves.toEqual({
      success: false,
      error: 'Staged selection changed before dispatch',
    });
    expect(getGitCurrentIndexCommit(owner.state(), 'commit-preflight')?.status).toBe('failed');
    const result: MutationResult = {
      success: true,
      commitOutcome: { state: 'confirmed', hash: 'actual-sha', files: ['a.ts'] },
    };
    owner.execute.mockResolvedValueOnce(result);
    const next = gitWriteRequested('commit-preflight', 'second', { ...operation });
    owner.dispatch(next);
    await expect(next.promise).resolves.toEqual(result);
    expect(owner.execute).toHaveBeenCalledTimes(2);
  });
  it('cancels current-index work before its queued execution microtask can dispatch', async () => {
    const execute = vi.fn<() => Promise<MutationResult>>();
    const owner = start({
      prepare: function* () {
        queueMicrotask(() => owner.task.cancel());
        return execute;
      },
    });
    const request = gitWriteRequested('commit-microtask', 'first', {
      kind: 'commit',
      params: { message: 'Checkpoint', userRequested: true, currentIndex: true },
    });
    owner.dispatch(request);
    await expect(request.promise).rejects.toThrow('unavailable');
    expect(execute).not.toHaveBeenCalled();
    expect(isGitMutationPending('commit-microtask')).toBe(false);
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'commit-microtask', 'first'),
    ).toMatchObject({ status: 'failed', result: { success: false } });
  });
  it('blocks duplicate current-index commits during execution and after an unknown outcome survives unmount', async () => {
    const held = deferred<MutationResult>();
    const owner = start();
    owner.execute.mockReturnValueOnce(held.promise);
    const operation = {
      kind: 'commit' as const,
      params: { message: 'Checkpoint', userRequested: true, currentIndex: true as const },
      consumerId: 'panel',
    };
    const request = gitWriteRequested('commit-unmount', 'first', operation);
    owner.dispatch(request);
    await vi.waitFor(() => expect(owner.execute).toHaveBeenCalledTimes(1));
    owner.dispatch(gitWriteConsumerReleased('commit-unmount', 'panel'));
    owner.dispatch(workspaceUnmounted('commit-unmount'));
    const duplicate = gitWriteRequested('commit-unmount', 'second', { ...operation });
    owner.dispatch(duplicate);
    const result: MutationResult = { success: false, commitOutcome: { state: 'unknown' } };
    held.resolve(result);
    await expect(request.promise).resolves.toEqual(result);
    await expect(duplicate.promise).resolves.toMatchObject({ success: false });
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'commit-unmount', 'first'),
    ).toMatchObject({ status: 'unknown', result });
    const retry = gitWriteRequested('commit-unmount', 'retry', { ...operation });
    owner.dispatch(retry);
    await expect(retry.promise).resolves.toMatchObject({ success: false });
    expect(owner.execute).toHaveBeenCalledTimes(1);
    expect(owner.publish).not.toHaveBeenCalled();
    expect(isGitMutationPending('commit-unmount')).toBe(false);
  });

  it.each([
    {
      success: true,
      commitOutcome: { state: 'confirmed' as const, hash: 'actual-sha', files: ['a.ts'] },
    },
    { success: false, commitOutcome: { state: 'unknown' as const } },
  ])('preserves an actual current-index outcome after cancellation: %j', async (result) => {
    const held = deferred<MutationResult>();
    const owner = start();
    owner.execute.mockReturnValueOnce(held.promise);
    const request = gitWriteRequested('commit-cancel', 'first', {
      kind: 'commit',
      params: { message: 'Checkpoint', userRequested: true, currentIndex: true },
    });
    owner.dispatch(request);
    await vi.waitFor(() => expect(owner.execute).toHaveBeenCalledTimes(1));
    owner.task.cancel();
    expect(isGitMutationPending('commit-cancel')).toBe(true);
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'commit-cancel', 'first')?.status,
    ).toBe('running');
    held.resolve(result);
    await expect(request.promise).resolves.toEqual(result);
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'commit-cancel', 'first'),
    ).toMatchObject({ status: result.success ? 'succeeded' : 'unknown', result });
    expect(owner.publish).not.toHaveBeenCalled();
    expect(isGitMutationPending('commit-cancel')).toBe(false);
  });

  it('cancels a queued current-index commit before execution without fabricating uncertainty', async () => {
    const lease = reserveGitMutation('commit-queued');
    const owner = start();
    const request = gitWriteRequested('commit-queued', 'first', {
      kind: 'commit',
      params: { message: 'Checkpoint', userRequested: true, currentIndex: true },
    });
    owner.dispatch(request);
    owner.dispatch(cancelQueuedGitWrite('commit-queued', 'first'));
    await lease.release();
    await expect(request.promise).resolves.toMatchObject({ success: false });
    expect(owner.execute).not.toHaveBeenCalled();
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'commit-queued', 'first')?.status,
    ).toBe('cancelled');
    expect(isGitMutationPending('commit-queued')).toBe(false);
  });

  it.each([
    {
      success: true,
      commitOutcome: { state: 'confirmed' as const, hash: 'actual-sha', files: ['a.ts'] },
    },
    { success: false, commitOutcome: { state: 'unknown' as const } },
  ])(
    'retains a cancelled commit receipt under its initiating identity after authority loss: %j',
    async (result) => {
      let current = true;
      const held = deferred<MutationResult>();
      const owner = start({
        captureAuthority: () => ({ canDispatch: () => current, canPublish: () => current }),
      });
      owner.execute.mockReturnValueOnce(held.promise);
      const request = gitWriteRequested('commit-principal', 'first', {
        kind: 'commit',
        params: { message: 'Checkpoint', userRequested: true, currentIndex: true },
        authorityKey: 'original/root',
        consumerId: 'panel',
      });
      owner.dispatch(request);
      await vi.waitFor(() => expect(owner.execute).toHaveBeenCalledTimes(1));
      current = false;
      const boundary = owner.actions.length;
      owner.task.cancel();
      held.resolve(result);
      await expect(request.promise).resolves.toEqual(result);
      expect(owner.actions.slice(boundary)).toEqual([
        gitWriteFinished('commit-principal', 'first', result, request.payload[2], true),
      ]);
      owner.dispatch(gitWriteConsumerReleased('commit-principal', 'panel'));
      owner.dispatch(workspaceUnmounted('commit-principal'));
      expect(
        getGitCurrentIndexCommit(owner.state(), 'commit-principal', 'original/root'),
      ).toMatchObject({ result });
      expect(
        getGitCurrentIndexCommit(owner.state(), 'commit-principal', 'replacement/root'),
      ).toBeUndefined();
      expect(getGitCurrentIndexCommit(owner.state(), 'commit-principal')).toBeUndefined();
      expect(owner.publish).not.toHaveBeenCalled();
      expect(owner.reconcile).not.toHaveBeenCalled();
      expect(owner.invalidate).not.toHaveBeenCalled();
      expect(isGitMutationPending('commit-principal')).toBe(false);
    },
  );
  it('captures authority at dispatch and refuses a queued request after its epoch changes', async () => {
    let epoch = 1;
    const captured: number[] = [];
    const held = reserveGitMutation('epoch');
    const owner = start({
      captureAuthority: () => {
        const admitted = epoch;
        captured.push(admitted);
        return { canDispatch: () => epoch === admitted, canPublish: () => true };
      },
    });
    const request = gitWriteRequested('epoch', 'stage', { kind: 'stage', paths: ['a.ts'] });
    owner.dispatch(request);
    expect(captured).toEqual([1]);
    epoch = 2;
    await held.release();
    await expect(request.promise).resolves.toMatchObject({ success: false });
    expect(owner.execute).not.toHaveBeenCalled();
    expect(selectGitWriteOperation.select(owner.state() as never, 'epoch', 'stage')?.status).toBe(
      'failed',
    );
  });

  it('rechecks dispatch authority inside the lease microtask before I/O', async () => {
    let allowed = true;
    const owner = start({
      captureAuthority: () => ({ canDispatch: () => allowed, canPublish: () => true }),
      prepare: function* () {
        queueMicrotask(() => {
          allowed = false;
        });
        return async () => {
          throw new Error('transport must not run');
        };
      },
    });
    const request = gitWriteRequested('microtask', 'stage', { kind: 'stage', paths: ['a.ts'] });
    owner.dispatch(request);
    await expect(request.promise).resolves.toEqual({ success: false, error: 'unavailable' });
  });

  it('settles an applied write after an epoch change while the same authority remains', async () => {
    let epoch = 1;
    const held = deferred<MutationResult>();
    const owner = start({
      captureAuthority: () => {
        const admitted = epoch;
        return { canDispatch: () => epoch === admitted, canPublish: () => true };
      },
    });
    owner.execute.mockReturnValue(held.promise);
    const request = gitWriteRequested('reconnect', 'stage', { kind: 'stage', paths: ['a.ts'] });
    owner.dispatch(request);
    await vi.waitFor(() => expect(owner.execute).toHaveBeenCalledTimes(1));
    epoch = 2;
    held.resolve({ success: true });
    await expect(request.promise).resolves.toEqual({ success: true });
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'reconnect', 'stage')?.status,
    ).toBe('succeeded');
    expect(owner.publish).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'retires success=%s without publishing UI state to a replacement principal',
    async (success) => {
      let principal = 'original';
      const held = deferred<MutationResult>();
      const owner = start({
        captureAuthority: () => {
          const admitted = principal;
          return {
            canDispatch: () => principal === admitted,
            canPublish: () => principal === admitted,
          };
        },
      });
      owner.execute.mockReturnValue(held.promise);
      const initial: GitStatus = {
        branch: 'main',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [{ path: 'a.ts', staged: false, status: GitFileStatus.Modified }],
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
      };
      owner.dispatch(setGitStatus('principal', initial));
      const request = gitWriteRequested('principal', 'stage', { kind: 'stage', paths: ['a.ts'] });
      owner.dispatch(request);
      await vi.waitFor(() => expect(owner.execute).toHaveBeenCalledTimes(1));
      principal = 'replacement';
      const boundary = owner.actions.length;
      held.resolve({ success });
      await expect(request.promise).resolves.toEqual({ success });
      expect(owner.actions.slice(boundary)).toEqual([
        gitWriteFinished('principal', 'stage', { success }, request.payload[2], true),
      ]);
      expect(owner.state().gitWrite.byWorkspaceId.principal).toBeUndefined();
      expect(owner.reconcile).not.toHaveBeenCalled();
      expect(owner.publish).not.toHaveBeenCalled();
      expect(owner.invalidate).not.toHaveBeenCalled();
      expect(isGitMutationPending('principal')).toBe(false);
    },
  );

  it('keeps a released consumer operation pending until transport settlement without late UI effects', async () => {
    const held = deferred<MutationResult>();
    const owner = start();
    owner.execute.mockReturnValueOnce(held.promise);
    const request = gitWriteRequested('released', 'stage', {
      kind: 'stage',
      paths: ['a.ts'],
      consumerId: 'panel',
    });
    owner.dispatch(request);
    await vi.waitFor(() => expect(owner.execute).toHaveBeenCalledTimes(1));
    owner.dispatch(gitWriteConsumerReleased('released', 'panel'));
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'released', 'stage'),
    ).toMatchObject({
      status: 'running',
      consumerReleased: true,
    });
    expect(isGitMutationPending('released')).toBe(true);
    const next = gitWriteRequested('released', 'next', { kind: 'unstage', paths: ['a.ts'] });
    owner.dispatch(next);
    expect(owner.execute).toHaveBeenCalledTimes(1);
    held.resolve({ success: true });
    await request.promise;
    await next.promise;
    expect(owner.execute).toHaveBeenCalledTimes(2);
    expect(owner.publish).toHaveBeenCalledTimes(1);
    expect(owner.reconcile).toHaveBeenCalledTimes(1);
  });

  it('does not publish an optimistic snapshot if the consumer releases during preparation', async () => {
    const gate = deferred<void>();
    const preparing = vi.fn();
    const execute = vi.fn<() => Promise<MutationResult>>().mockResolvedValue({ success: true });
    const owner = start({
      prepare: function* () {
        preparing();
        yield* call(() => gate.promise);
        return execute;
      },
    });
    owner.dispatch(
      setGitStatus('preparing', {
        branch: 'main',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [{ path: 'a.ts', staged: false, status: GitFileStatus.Modified }],
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
      }),
    );
    const request = gitWriteRequested('preparing', 'stage', {
      kind: 'stage',
      paths: ['a.ts'],
      consumerId: 'panel',
    });
    owner.dispatch(request);
    await vi.waitFor(() => expect(preparing).toHaveBeenCalledTimes(1));
    owner.dispatch(gitWriteConsumerReleased('preparing', 'panel'));
    const boundary = owner.actions.length;
    gate.resolve();
    await expect(request.promise).resolves.toEqual({ success: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(owner.actions.slice(boundary).map((action) => action.type)).not.toContain(
      setGitStatus.type,
    );
    expect(owner.publish).not.toHaveBeenCalled();
    expect(owner.reconcile).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'rejects cancelled queued work before its prior lease settles with retired=%s',
    async (retired) => {
      let current = true;
      const held = reserveGitMutation('cancel-queued');
      const owner = start({
        captureAuthority: () => ({ canDispatch: () => current, canPublish: () => current }),
      });
      const request = gitWriteRequested('cancel-queued', 'stage', {
        kind: 'stage',
        paths: ['a.ts'],
      });
      owner.dispatch(request);
      current = !retired;
      const boundary = owner.actions.length;
      owner.task.cancel();
      try {
        await expect(request.promise).rejects.toThrow('unavailable');
        expect(owner.execute).not.toHaveBeenCalled();
        expect(isGitMutationPending('cancel-queued')).toBe(true);
        expect(
          selectGitWriteOperation.select(owner.state() as never, 'cancel-queued', 'stage')?.status,
        ).toBe('queued');
        if (retired) expect(owner.actions.slice(boundary)).toEqual([]);
      } finally {
        await held.release();
      }
      await vi.waitFor(() => expect(isGitMutationPending('cancel-queued')).toBe(false));
      expect(owner.execute).not.toHaveBeenCalled();
      expect(owner.publish).not.toHaveBeenCalled();
      expect(owner.reconcile).not.toHaveBeenCalled();
      if (retired) expect(owner.state().gitWrite.byWorkspaceId['cancel-queued']).toBeUndefined();
    },
  );

  it.each([false, true])(
    'waits for transport settlement on cancellation with retired=%s',
    async (retired) => {
      let current = true;
      const held = deferred<MutationResult>();
      const owner = start({
        captureAuthority: () => ({
          canDispatch: () => current,
          canPublish: () => current,
        }),
      });
      owner.execute.mockReturnValueOnce(held.promise);
      const request = gitWriteRequested('cancel-owner', 'stage', {
        kind: 'stage',
        paths: ['a.ts'],
      });
      owner.dispatch(request);
      await vi.waitFor(() => expect(owner.execute).toHaveBeenCalledTimes(1));
      current = !retired;
      const boundary = owner.actions.length;
      owner.task.cancel();
      expect(
        selectGitWriteOperation.select(owner.state() as never, 'cancel-owner', 'stage')?.status,
      ).toBe('running');
      expect(owner.actions.slice(boundary)).toEqual([]);
      expect(isGitMutationPending('cancel-owner')).toBe(true);
      held.resolve({ success: true });
      await expect(request.promise).rejects.toThrow('unavailable');
      expect(isGitMutationPending('cancel-owner')).toBe(false);
      if (retired) {
        expect(owner.state().gitWrite.byWorkspaceId['cancel-owner']).toBeUndefined();
        expect(owner.actions.slice(boundary)).toEqual([
          gitWriteFinished(
            'cancel-owner',
            'stage',
            { success: false, error: 'unavailable' },
            request.payload[2],
            true,
          ),
        ]);
      } else {
        expect(
          selectGitWriteOperation.select(owner.state() as never, 'cancel-owner', 'stage')?.status,
        ).toBe('failed');
      }
      expect(owner.publish).not.toHaveBeenCalled();
      expect(owner.reconcile).not.toHaveBeenCalled();
    },
  );

  it('retires an old-principal queued entry only after its lease dependency settles', async () => {
    let current = true;
    const held = reserveGitMutation('retired-queue');
    const owner = start({
      captureAuthority: () => ({ canDispatch: () => current, canPublish: () => current }),
    });
    const request = gitWriteRequested('retired-queue', 'stage', { kind: 'stage', paths: ['a.ts'] });
    owner.dispatch(request);
    current = false;
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'retired-queue', 'stage')?.status,
    ).toBe('queued');
    await held.release();
    await expect(request.promise).resolves.toMatchObject({ success: false });
    expect(owner.execute).not.toHaveBeenCalled();
    expect(owner.state().gitWrite.byWorkspaceId['retired-queue']).toBeUndefined();
  });

  it('allows a host to wait for authoritative status without optimistic updates or rollback', async () => {
    const owner = start({ optimisticStatus: false });
    owner.execute.mockResolvedValue({ success: false, error: 'index locked' });
    const initial: GitStatus = {
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [{ path: 'a.ts', staged: true, status: GitFileStatus.Modified }],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    };
    owner.dispatch(setGitStatus('no-optimism', initial));
    const boundary = owner.actions.length;
    const request = gitWriteRequested('no-optimism', 'unstage', {
      kind: 'unstage',
      paths: ['a.ts'],
    });
    owner.dispatch(request);
    await expect(request.promise).resolves.toEqual({ success: false, error: 'index locked' });
    expect(owner.actions.slice(boundary).map((action) => action.type)).not.toContain(
      setGitStatus.type,
    );
    expect(owner.state().git.byWorkspaceId['no-optimism'].status).toBe(initial);
    expect(owner.reconcile).not.toHaveBeenCalled();
  });
});
