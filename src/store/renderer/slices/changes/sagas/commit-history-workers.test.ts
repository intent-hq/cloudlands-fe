import { describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import type { CommitHistoryPage } from '../../../../../lib/client/commit-history-types';
import { createBackendCommitHistoryReader } from '../../../../../lib/client/live/backend-commit-history-reader';
import { createCommitHistoryWorkers } from './commit-history-workers';
import { fileTrackingReducer, clearWorkspace, commitHistorySucceeded } from '../changes-slice';
import {
  getCurrentCommits,
  getOlderCommits,
  getCommitByHash,
  getCommitHistory,
} from '../changes-projections';
import type { CommitHistoryRequest } from '../changes-types';

function page(hashes: string[], nextToken: string | null = null) {
  return {
    commits: hashes.map((hash) => ({
      hash,
      message: hash,
      author: 'Author',
      date: '2026-10-15T01:00:00Z',
      isPushed: false,
    })),
    boundarySha: 'boundary',
    nextToken,
  };
}

function fixture() {
  let state = { changes: fileTrackingReducer(undefined, { type: '@@init' }) };
  let context: string | null = 'principal-A';
  const actions: { type: string; payload?: unknown }[] = [];
  const request = vi.fn().mockResolvedValue(page([]));
  const workers = createCommitHistoryWorkers({
    readPage: (workspaceId, options, isCurrent) =>
      createBackendCommitHistoryReader({ request, isCurrent })(workspaceId, options),
    readCurrentContext: () => context,
    admittedContext: function* () {
      return context;
    },
  });
  function dispatch(action: { type: string; payload?: unknown }) {
    actions.push(action);
    state = { changes: fileTrackingReducer(state.changes, action) };
  }
  const run = (work: () => SagaGenerator<void>) =>
    runSaga({ dispatch, getState: () => state }, work);
  return {
    request,
    workers,
    actions,
    dispatch,
    run,
    refresh: () => run(() => workers.refresh('ws')).toPromise(),
    more: (older = false) => run(() => workers.loadMore('ws', older)).toPromise(),
    state: () => state,
    history: () => getCommitHistory(state, 'ws'),
    context: (value: string | null) => {
      context = value;
    },
  };
}

describe('canonical commit history worker policy', () => {
  it('pages current and inclusive older history with independent tokens and one entity per hash', async () => {
    const f = fixture();
    f.request
      .mockResolvedValueOnce(page(['new', 'middle'], 'current-2'))
      .mockResolvedValueOnce(page(['middle', 'last', 'last']))
      .mockResolvedValueOnce(page(['new', 'middle', 'last', 'boundary'], 'older-2'))
      .mockResolvedValueOnce(page(['boundary', 'old']));
    await f.refresh();
    await f.more();
    await f.more(true);
    await f.more(true);
    await f.more();
    await f.more(true);
    expect(f.request.mock.calls).toEqual([
      ['file-tracking.loadCommits', { workspaceId: 'ws', includeOlder: false, limit: 20 }],
      [
        'file-tracking.loadCommits',
        { workspaceId: 'ws', includeOlder: false, limit: 20, nextToken: 'current-2' },
      ],
      ['file-tracking.loadCommits', { workspaceId: 'ws', includeOlder: true, limit: 20 }],
      [
        'file-tracking.loadCommits',
        { workspaceId: 'ws', includeOlder: true, limit: 20, nextToken: 'older-2' },
      ],
    ]);
    expect(getCurrentCommits(f.state(), 'ws').map((x) => x.hash)).toEqual([
      'new',
      'middle',
      'last',
    ]);
    expect(getOlderCommits(f.state(), 'ws').map((x) => x.hash)).toEqual(['boundary', 'old']);
    expect(f.state().changes.byWorkspaceId.ws.commitEntities.ids).toHaveLength(5);
    expect(getCommitByHash(f.state(), 'ws', 'new')?.message).toBe('new');
    expect(f.history().older).toMatchObject({ loaded: true, loading: false, nextToken: null });
    expect(JSON.parse(JSON.stringify(f.state()))).toEqual(f.state());
  });

  it('records read errors, retains the successful page, and retries the same cursor once', async () => {
    const f = fixture();
    f.request
      .mockResolvedValueOnce(page(['one'], 'next'))
      .mockRejectedValueOnce(new Error('read denied'))
      .mockResolvedValueOnce(page(['two']));
    await f.refresh();
    await f.more();
    expect(f.history().current).toMatchObject({
      loading: false,
      nextToken: 'next',
      error: 'read denied',
    });
    expect(getCurrentCommits(f.state(), 'ws').map((x) => x.hash)).toEqual(['one']);
    await f.more();
    expect(f.request.mock.calls[1]).toEqual(f.request.mock.calls[2]);
    expect(getCurrentCommits(f.state(), 'ws').map((x) => x.hash)).toEqual(['one', 'two']);
    expect(f.history().current.error).toBeNull();
  });

  it('distinguishes initial failure from successful empty history', async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new Error('offline'));
    await f.refresh();
    expect(f.history().current).toMatchObject({ loaded: false, loading: false, error: 'offline' });
    await f.refresh();
    expect(f.history().current).toMatchObject({ loaded: true, loading: false, error: null });
  });

  it('ignores duplicate concurrent page requests and rejects cursor cycles', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(page(['one'], 'token'));
    await f.refresh();
    let resolve!: (result: unknown) => void;
    f.request.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const pending = f.more();
    await f.more();
    expect(f.request).toHaveBeenCalledTimes(2);
    resolve(page(['two'], 'token'));
    await pending;
    expect(f.history().current).toMatchObject({
      loading: false,
      error: expect.any(String),
      nextToken: 'token',
    });
    expect(getCurrentCommits(f.state(), 'ws').map((x) => x.hash)).toEqual(['one']);
  });

  it('refresh invalidates outstanding older pages and resets both token sequences', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(page(['before']));
    await f.refresh();
    let resolve!: (result: unknown) => void;
    f.request.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const older = f.more(true);
    f.request.mockResolvedValueOnce(page(['after'], 'new-token'));
    await f.refresh();
    resolve(page(['obsolete'], 'obsolete-token'));
    await older;
    expect(getCurrentCommits(f.state(), 'ws').map((x) => x.hash)).toEqual(['after']);
    expect(getOlderCommits(f.state(), 'ws')).toEqual([]);
    expect(f.history().older).toMatchObject({ loaded: false, nextToken: null, consumedTokens: [] });
    expect(f.history().current.consumedTokens).toEqual([null]);
  });

  it('rejects retired and old-generation settlements, including after unmount/remount', async () => {
    const f = fixture();
    let resolve!: (result: unknown) => void;
    f.request.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const pending = f.refresh();
    const start = f.actions[0].payload as [string, CommitHistoryRequest];
    f.context(null);
    f.dispatch(clearWorkspace('ws'));
    resolve(page(['retired']));
    await pending;
    expect(f.state().changes.byWorkspaceId.ws).toBeUndefined();
    f.context('principal-B');
    f.request.mockResolvedValueOnce(page(['fresh']));
    await f.refresh();
    const before = f.state().changes;
    f.dispatch(
      commitHistorySucceeded('ws', start[1], { commits: [], boundarySha: null, nextToken: null }),
    );
    expect(f.state().changes).toBe(before);
    expect(getCurrentCommits(f.state(), 'ws').map((x) => x.hash)).toEqual(['fresh']);
  });

  it('cancellation settles loading without consuming a cursor and permits retry', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(page(['one'], 'next'));
    await f.refresh();
    let resolve!: (result: CommitHistoryPage) => void;
    f.request.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const task = f.run(() => f.workers.loadMore('ws'));
    task.cancel();
    await task.toPromise();
    expect(f.history().current).toMatchObject({ loading: false, nextToken: 'next', error: null });
    resolve({ commits: [], boundarySha: null, nextToken: null });
    f.request.mockResolvedValueOnce(page(['two']));
    await f.more();
    expect(getCurrentCommits(f.state(), 'ws').map((x) => x.hash)).toEqual(['one', 'two']);
  });
});

it('retires the deferred-dispatch admission callback on cancellation and principal replacement', async () => {
  let state = { changes: fileTrackingReducer(undefined, { type: '@@init' }) };
  let context: string | null = 'principal-A';
  let current!: () => boolean;
  const workers = createCommitHistoryWorkers({
    admittedContext: function* () {
      return context;
    },
    readCurrentContext: () => context,
    readPage: (_workspaceId, _options, isCurrent) => {
      current = isCurrent;
      return new Promise<CommitHistoryPage>(() => {});
    },
  });
  const task = runSaga(
    {
      dispatch: (action) => {
        state = { changes: fileTrackingReducer(state.changes, action) };
      },
      getState: () => state,
    },
    workers.refresh,
    'ws',
  );
  expect(current()).toBe(true);
  context = 'principal-B';
  expect(current()).toBe(false);
  context = 'principal-A';
  task.cancel();
  await task.toPromise();
  expect(current()).toBe(false);
});

it('starts older history at its own boundary cursor while current pages remain', async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce(page(['current'], 'current-next'))
    .mockResolvedValueOnce(page(['boundary'], 'older-next'));
  await f.refresh();
  await f.more(true);
  expect(f.request.mock.calls).toEqual([
    ['file-tracking.loadCommits', { workspaceId: 'ws', includeOlder: false, limit: 20 }],
    ['file-tracking.loadCommits', { workspaceId: 'ws', includeOlder: true, limit: 20 }],
  ]);
  expect(f.history().current.nextToken).toBe('current-next');
  expect(f.history().older.nextToken).toBe('older-next');
  expect(getOlderCommits(f.state(), 'ws').map((commit) => commit.hash)).toEqual(['boundary']);
});
