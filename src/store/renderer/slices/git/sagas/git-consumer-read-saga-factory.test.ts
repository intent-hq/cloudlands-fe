import { runSaga, stdChannel, type EffectMiddleware } from 'redux-saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call } from 'typed-redux-saga';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  gitReducer,
  gitReadRequested,
  gitReadCompleted,
  gitReadsInvalidated,
  releaseGitRead,
} from '../git-slice';
import type { GitConsumerReadDependencies, GitReadRequest, GitReadResult } from '../git-types';
import { createGitConsumerReadSaga } from './git-consumer-read-saga-factory';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const request: GitReadRequest = { kind: 'diffs', path: 'a.ts', staged: true, gitRootId: 'root' };
const empty: GitReadResult = { kind: 'diffs', chunks: [] };
const fresh: GitReadResult = {
  kind: 'diffs',
  chunks: [{ file: 'a.ts', chunks: [], newContent: 'fresh' }],
};
type Action = Parameters<typeof gitReducer>[1];
const tasks: ReturnType<typeof runSaga>[] = [];

function start(
  read: GitConsumerReadDependencies['read'],
  ports: Partial<GitConsumerReadDependencies> = {},
  effectMiddlewares?: EffectMiddleware[],
) {
  const channel = stdChannel();
  let state = gitReducer(undefined, { type: 'test/init' });
  const actions: Action[] = [];
  const dispatch = (action: Action) => {
    state = gitReducer(state, action);
    actions.push(action);
    channel.put(action);
  };
  const saga = createGitConsumerReadSaga({
    read,
    getMutationVersion: () => 0,
    isMutationPending: () => false,
    waitForMutations: async () => {},
    dispatch,
    ...ports,
  });
  const task = runSaga({ channel, dispatch, effectMiddlewares }, saga);
  tasks.push(task);
  return {
    dispatch,
    task,
    completions: () => actions.filter((action) => action.type === gitReadCompleted.type),
    view(consumerId = 'view', workspaceId = 'ws') {
      const ws = state.byWorkspaceId[workspaceId];
      if (!ws) return undefined;
      const consumer = getItem(ws.readConsumers, consumerId);
      return consumer ? getItem(ws.reads, consumer.readKey) : undefined;
    },
  };
}

afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

describe('createGitConsumerReadSaga', () => {
  it.each(['recorded', 'unavailable'] as const)(
    'settles %s transcript content while current-file reads are denied',
    async (mode) => {
      const transcript: GitReadRequest = {
        kind: 'trackedDiff',
        filePath: 'remote.ts',
        workspacePath: '',
        stage: 'committed',
        useProvidedContent: true,
        forceRefresh: false,
        allowHeadReads: false,
      };
      const result: GitReadResult = {
        kind: 'trackedDiff',
        oldContent: 'recorded old',
        newContent: 'recorded new',
        gitlink: false,
      };
      const read = vi.fn<GitConsumerReadDependencies['read']>(
        async (_ws, _request, _signal, canRead) => {
          expect(canRead()).toBe(false);
          if (mode === 'unavailable') throw new Error('Recorded content unavailable');
          return result;
        },
      );
      const owner = start(read);
      owner.dispatch(gitReadRequested('ws', 'view', 'transcript', transcript, () => false));
      await vi.waitFor(() => expect(owner.view()?.loading).toBe(false));
      expect(read).toHaveBeenCalledTimes(1);
      expect(owner.view()?.error).toBe(
        mode === 'unavailable' ? 'Recorded content unavailable' : null,
      );
      if (mode === 'recorded') expect(owner.view()?.result).toEqual(result);
      owner.dispatch(releaseGitRead('ws', 'view', 'transcript'));
      expect(owner.view()).toBeUndefined();
    },
  );

  it('shares a same-key flight and releases only the matching consumer request', async () => {
    const response = deferred<GitReadResult>();
    const read = vi.fn<GitConsumerReadDependencies['read']>().mockReturnValue(response.promise);
    const owner = start(read);
    owner.dispatch(gitReadRequested('ws', 'view', 'old', request));
    owner.dispatch(gitReadRequested('ws', 'view', 'new', request));
    owner.dispatch(gitReadRequested('ws', 'other', 'other', request));
    owner.dispatch(releaseGitRead('ws', 'view', 'old'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0].slice(0, 2)).toEqual(['ws', request]);
    const [, , signal, canRead] = read.mock.calls[0];
    owner.dispatch(releaseGitRead('ws', 'other', 'other'));
    expect(signal.aborted).toBe(false);
    response.resolve(fresh);
    await vi.waitFor(() => expect(owner.view()?.loading).toBe(false));
    expect(owner.completions()).toHaveLength(1);
    expect(owner.view('other')).toBeUndefined();
    owner.dispatch(releaseGitRead('ws', 'view', 'new'));
    expect(owner.view()).toBeUndefined();
    expect(signal.aborted).toBe(true);
    expect(canRead()).toBe(false);
  });

  it.each(['release', 'unmount', 'cancel'] as const)(
    'aborts a pending read on %s and drops its late result',
    async (reason) => {
      const response = deferred<GitReadResult>();
      const read = vi.fn<GitConsumerReadDependencies['read']>().mockReturnValue(response.promise);
      const owner = start(read);
      owner.dispatch(gitReadRequested('ws', 'view', 'request', request));
      const [, , signal, canRead] = read.mock.calls[0];
      if (reason === 'release') owner.dispatch(releaseGitRead('ws', 'view', 'request'));
      else if (reason === 'unmount') owner.dispatch(workspaceUnmounted('ws'));
      else owner.task.cancel();
      expect(signal.aborted).toBe(true);
      expect(canRead()).toBe(false);
      response.resolve(fresh);
      await response.promise;
      expect(owner.completions()).toEqual([]);
    },
  );

  it('retries explicit errors while sharing successful empty results', async () => {
    const read = vi
      .fn<GitConsumerReadDependencies['read']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(empty);
    const owner = start(read);
    const action = gitReadRequested('ws', 'view', 'request', request);
    owner.dispatch(action);
    await vi.waitFor(() =>
      expect(owner.view()).toMatchObject({ error: 'offline', loading: false }),
    );
    owner.dispatch(action);
    await vi.waitFor(() => expect(owner.view()).toMatchObject({ error: null, loading: false }));
    owner.dispatch(action);
    owner.dispatch(gitReadRequested('ws', 'other', 'other', request));
    expect(read).toHaveBeenCalledTimes(2);
    expect(owner.view('other')?.result).toMatchObject({ kind: 'diffs' });
  });

  it('waits for root-scoped mutations and coalesces stale revisions into one fresh read', async () => {
    const first = deferred<GitReadResult>();
    const barrier = deferred<void>();
    let pending = false;
    let version = 0;
    const waitForMutations = vi.fn(() => barrier.promise);
    const read = vi
      .fn<GitConsumerReadDependencies['read']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(fresh);
    const owner = start(read, {
      getMutationVersion: () => version,
      isMutationPending: () => pending,
      waitForMutations,
    });
    owner.dispatch(gitReadRequested('ws', 'view', 'request', request));
    pending = true;
    version++;
    owner.dispatch(gitReadsInvalidated('ws', 'root'));
    owner.dispatch(gitReadsInvalidated('ws', 'root'));
    first.resolve(empty);
    await vi.waitFor(() => expect(waitForMutations).toHaveBeenCalledWith('ws', 'root'));
    expect(owner.completions()).toHaveLength(0);
    expect(read).toHaveBeenCalledTimes(1);
    pending = false;
    version++;
    barrier.resolve();
    await vi.waitFor(() => expect(owner.view()?.loading).toBe(false));
    expect(read).toHaveBeenCalledTimes(2);
    expect(owner.completions()).toHaveLength(1);
  });

  it('rechecks authority after waiting for mutation settlement', async () => {
    const barrier = deferred<void>();
    let allowed = true;
    const read = vi.fn<GitConsumerReadDependencies['read']>().mockResolvedValue(empty);
    const owner = start(read, {
      isMutationPending: () => true,
      waitForMutations: () => barrier.promise,
    });
    owner.dispatch(gitReadRequested('ws', 'view', 'request', request, () => allowed));
    allowed = false;
    barrier.resolve();
    await barrier.promise;
    expect(read).not.toHaveBeenCalled();
    expect(owner.completions()).toEqual([]);
  });

  it('denies a retired request before admission', () => {
    const read = vi.fn<GitConsumerReadDependencies['read']>().mockResolvedValue(empty);
    const owner = start(read);
    owner.dispatch(gitReadRequested('ws', 'view', 'request', request, () => false));
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['success', 'error'] as const)(
    'suppresses %s after authority retirement',
    async (outcome) => {
      const response = deferred<GitReadResult>();
      let allowed = true;
      const read = vi.fn<GitConsumerReadDependencies['read']>().mockReturnValue(response.promise);
      const owner = start(read);
      owner.dispatch(gitReadRequested('ws', 'view', 'request', request, () => allowed));
      allowed = false;
      if (outcome === 'success') response.resolve(fresh);
      else response.reject(new Error('retired transport'));
      await vi.waitFor(() => expect(read.mock.calls[0][2].aborted).toBe(true));
      expect(owner.completions()).toEqual([]);
    },
  );

  it('never lets a replacement authority publish the previous authority’s pending result', async () => {
    const response = deferred<GitReadResult>();
    let oldAllowed = true;
    const read = vi
      .fn<GitConsumerReadDependencies['read']>()
      .mockReturnValueOnce(response.promise)
      .mockResolvedValue(fresh);
    const owner = start(read);
    owner.dispatch(gitReadRequested('ws', 'view', 'old', request, () => oldAllowed));
    oldAllowed = false;
    owner.dispatch(gitReadRequested('ws', 'view', 'new', request, () => true));
    response.resolve(empty);
    await vi.waitFor(() => expect(owner.view()?.loading).toBe(false));
    expect(read).toHaveBeenCalledTimes(2);
    expect(owner.completions()).toHaveLength(1);
    expect(owner.completions()[0].payload).toEqual([
      'ws',
      expect.any(String),
      expect.any(String),
      fresh,
      null,
    ]);
  });

  it('fences synchronous host publication when authority retires at the effect boundary', async () => {
    const response = deferred<GitReadResult>();
    let allowed = true;
    let retireOnCall = false;
    const fence: EffectMiddleware = (next) => (effect) => {
      if (
        retireOnCall &&
        effect &&
        typeof effect === 'object' &&
        'type' in effect &&
        effect.type === 'CALL'
      ) {
        retireOnCall = false;
        allowed = false;
      }
      return next(effect);
    };
    const read = vi.fn<GitConsumerReadDependencies['read']>().mockReturnValue(response.promise);
    const owner = start(read, {}, [fence]);
    owner.dispatch(gitReadRequested('ws', 'view', 'request', request, () => allowed));
    retireOnCall = true;
    response.resolve(fresh);
    await vi.waitFor(() => expect(read.mock.calls[0][2].aborted).toBe(true));
    expect(allowed).toBe(false);
    expect(owner.completions()).toEqual([]);
  });

  it('supports generator readers and source-bound auto-commit invalidation', async () => {
    let invalidateAgent!: (
      agentId: string,
    ) => ReturnType<NonNullable<GitConsumerReadDependencies['bindAutoCommitEvents']>>;
    const status = vi.fn().mockResolvedValue({ kind: 'autoCommitStatus', statuses: [] });
    const owner = start(
      function* () {
        return yield* call(status);
      },
      {
        *bindAutoCommitEvents(invalidate) {
          invalidateAgent = invalidate;
        },
      },
    );
    owner.dispatch(
      gitReadRequested('ws', 'view', 'request', { kind: 'autoCommitStatus', agentId: 'agent' }),
    );
    await vi.waitFor(() => expect(owner.view()?.loading).toBe(false));
    await runSaga({}, invalidateAgent, 'other').toPromise();
    expect(status).toHaveBeenCalledTimes(1);
    await runSaga({}, invalidateAgent, 'agent').toPromise();
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2));
  });
});

it('reconciles only matching worktree diff consumers and rejects their stale snapshots', async () => {
  const old = deferred<GitReadResult>();
  const next = deferred<GitReadResult>();
  const read = vi.fn<GitConsumerReadDependencies['read']>().mockResolvedValue(empty);
  read.mockImplementation((_ws, req) =>
    req.kind === 'diffs' && req.path === 'a.ts' && !req.staged && !req.commitHash && !req.gitRootId
      ? read.mock.calls.filter(
          ([, r]) =>
            r.kind === 'diffs' && r.path === 'a.ts' && !r.staged && !r.commitHash && !r.gitRootId,
        ).length === 1
        ? old.promise
        : next.promise
      : Promise.resolve(empty),
  );
  const owner = start(read);
  const requests: GitReadRequest[] = [
    { kind: 'diffs', path: 'a.ts' },
    { kind: 'diffs', paths: ['a.ts', 'b.ts'] },
    { kind: 'diffs' },
    { kind: 'diffs', path: 'b.ts' },
    { kind: 'diffs', path: 'a.ts', staged: true },
    { kind: 'diffs', path: 'a.ts', commitHash: 'a'.repeat(40) },
    { kind: 'commitDetails', commitHash: 'a'.repeat(40) },
    { kind: 'diffs', path: 'a.ts', gitRootId: 'secondary' },
  ];
  requests.forEach((req, i) => owner.dispatch(gitReadRequested('ws', String(i), String(i), req)));
  await vi.waitFor(() => expect(owner.completions()).toHaveLength(7));
  read.mockClear();
  // Keep the already captured first response pending while two saves invalidate it.
  read.mockImplementation((_ws, req) =>
    req.kind === 'diffs' && req.path === 'a.ts' && !req.gitRootId
      ? next.promise
      : Promise.resolve(empty),
  );
  owner.dispatch(gitReadsInvalidated('ws', undefined, { worktreePath: 'a.ts' }));
  owner.dispatch(gitReadsInvalidated('ws', undefined, { worktreePath: 'a.ts' }));
  old.resolve(empty);
  await vi.waitFor(() => expect(read.mock.calls.some(([, req]) => req === requests[0])).toBe(true));
  expect(owner.view('0')?.result).toBeNull();
  expect(new Set(read.mock.calls.map(([, req]) => requests.indexOf(req)))).toEqual(
    new Set([0, 1, 2]),
  );
  next.resolve(fresh);
  await vi.waitFor(() => expect(owner.view('0')?.loading).toBe(false));
  expect(owner.view('0')?.result).toMatchObject({ kind: 'diffs', chunks: { ids: ['a.ts'] } });
});
