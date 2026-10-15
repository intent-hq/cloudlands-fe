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
} from '../git-write-slice';
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
