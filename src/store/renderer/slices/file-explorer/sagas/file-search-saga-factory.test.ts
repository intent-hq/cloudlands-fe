import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileNameSearchResult } from '$lib/client/file-name-search-types';
import type { StoreAction } from '@themislib/themis/types';
import { createBackendFileNameSearch } from '$lib/client/live/backend-file-name-search';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { getFileSearch } from '../file-explorer-projections';
import {
  fileExplorerReducer,
  fileSearchOpened,
  fileSearchRequested,
  fileSearchReleased,
  fileSearchSettled,
  initialState,
  retireFileExplorer,
} from '../file-explorer-slice';
import { createFileSearchSaga } from './file-search-saga-factory';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function startSearch(
  read: Parameters<typeof createFileSearchSaga>[0]['read'],
  context: () => string | null = () => 'context',
) {
  const channel = stdChannel();
  let state = initialState;
  const actions: StoreAction<unknown>[] = [];
  const dispatch = (action: StoreAction<unknown>) => {
    actions.push(action);
    state = fileExplorerReducer(state, action);
    channel.put(action);
  };
  const task = runSaga(
    { channel, dispatch },
    createFileSearchSaga({
      read,
      admission: {
        readCurrentContext: context,
        dispatch,
        readSearch: (ws, consumer) => getFileSearch(state, ws, consumer),
      },
      skipWhitespaceOnly: true,
    }),
  );
  dispatch(fileSearchOpened('ws', 'consumer', context() ?? 'context'));
  dispatch(fileSearchOpened('ws', 'other', context() ?? 'context'));
  return { dispatch, task, actions, search: (id = 'consumer') => getFileSearch(state, 'ws', id) };
}

describe('shared filename search owner', () => {
  afterEach(() => vi.useRealTimers());

  it('debounces per consumer, keeps independent readers, and distinguishes pending from the delayed loader', async () => {
    vi.useFakeTimers();
    const first = deferred<FileNameSearchResult>();
    const second = deferred<FileNameSearchResult>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h = startSearch(read);
    try {
      h.dispatch(fileSearchRequested('ws', 'consumer', 'old', 'old', 'context'));
      await vi.advanceTimersByTimeAsync(25);
      h.dispatch(fileSearchRequested('ws', 'consumer', 'latest', 'new', 'context'));
      h.dispatch(fileSearchRequested('ws', 'other', 'independent', 'other', 'context'));
      expect(h.search()).toMatchObject({ query: 'new', loading: false, settled: false });
      await vi.advanceTimersByTimeAsync(49);
      expect(read).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(read.mock.calls.map(([ws, query]) => [ws, query])).toEqual([
        ['ws', 'new'],
        ['ws', 'other'],
      ]);
      await vi.advanceTimersByTimeAsync(499);
      expect(h.search()?.loading).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.search()?.loading).toBe(true);
      first.resolve({ files: ['new.ts'], truncated: true });
      second.resolve({ files: ['other.ts'], truncated: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.search()).toMatchObject({
        paths: ['new.ts'],
        loading: false,
        settled: true,
        truncated: true,
      });
      expect(h.search('other')?.paths).toEqual(['other.ts']);
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('suppresses empty and whitespace queries, and allows retry after an error', async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ files: [], truncated: false });
    const h = startSearch(read);
    try {
      for (const query of ['', ' \t\n ']) {
        h.dispatch(fileSearchRequested('ws', 'consumer', query, query, 'context'));
        await vi.advanceTimersByTimeAsync(550);
        expect(h.search()).toMatchObject({ paths: [], loading: false, settled: true, error: null });
      }
      expect(read).not.toHaveBeenCalled();
      h.dispatch(fileSearchRequested('ws', 'consumer', 'failure', 'file', 'context'));
      await vi.advanceTimersByTimeAsync(550);
      expect(h.search()).toMatchObject({
        paths: [],
        error: 'unavailable',
        settled: true,
        loading: false,
      });
      h.dispatch(fileSearchRequested('ws', 'consumer', 'retry', 'file', 'context'));
      expect(h.search()).toMatchObject({ error: null, settled: false });
      await vi.advanceTimersByTimeAsync(50);
      expect(h.search()).toMatchObject({ paths: [], error: null, settled: true });
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('captures context before debounce and rejects missing, changed, or mismatched admission', async () => {
    vi.useFakeTimers();
    let context: string | null = null;
    const read = vi.fn().mockResolvedValue({ files: [], truncated: false });
    const h = startSearch(read, () => context);
    try {
      h.dispatch(fileSearchRequested('ws', 'consumer', 'denied', 'file', 'context'));
      context = 'context';
      await vi.advanceTimersByTimeAsync(50);
      expect(read).not.toHaveBeenCalled();
      h.dispatch(fileSearchRequested('ws', 'consumer', 'changed', 'file', 'context'));
      context = 'replacement';
      await vi.advanceTimersByTimeAsync(550);
      h.dispatch(fileSearchRequested('ws', 'consumer', 'mismatch', 'file', 'context'));
      await vi.advanceTimersByTimeAsync(550);
      expect(read).not.toHaveBeenCalled();
      expect(h.actions.filter((action) => action.type === fileSearchSettled.type)).toEqual([]);
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('does not cancel admitted work when an old-context request is rejected', async () => {
    vi.useFakeTimers();
    const pending = deferred<FileNameSearchResult>();
    const read = vi.fn().mockReturnValue(pending.promise);
    const h = startSearch(read);
    try {
      h.dispatch(fileSearchRequested('ws', 'consumer', 'current', 'file', 'context'));
      await vi.advanceTimersByTimeAsync(50);
      h.dispatch(fileSearchRequested('ws', 'consumer', 'old', 'stale', 'old-context'));
      pending.resolve({ files: ['current.ts'], truncated: false });
      await vi.advanceTimersByTimeAsync(550);
      expect(read).toHaveBeenCalledTimes(1);
      expect(h.search()).toMatchObject({
        requestId: 'current',
        paths: ['current.ts'],
        settled: true,
      });
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('requires registration and rejects delayed request actions after release', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue({ files: [], truncated: false });
    const h = startSearch(read);
    try {
      h.dispatch(fileSearchRequested('ws', 'unregistered', 'no-owner', 'file', 'context'));
      h.dispatch(fileSearchReleased('ws', 'consumer'));
      h.dispatch(fileSearchRequested('ws', 'consumer', 'late', 'file', 'context'));
      await vi.advanceTimersByTimeAsync(550);
      expect(read).not.toHaveBeenCalled();
      expect(h.search()).toBeUndefined();
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it.each(['release', 'workspace', 'retire', 'root', 'open'] as const)(
    'fences a late response and loader after %s retirement even if context is reused',
    async (retirement) => {
      vi.useFakeTimers();
      let context = 'context';
      const old = deferred<FileNameSearchResult>();
      const read = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ files: ['current.ts'], truncated: false });
      const h = startSearch(read, () => context);
      try {
        h.dispatch(fileSearchRequested('ws', 'consumer', 'same-id', 'old', 'context'));
        await vi.advanceTimersByTimeAsync(50);
        const oldGuard = read.mock.calls[0][2] as () => boolean;
        if (retirement === 'release') h.dispatch(fileSearchReleased('ws', 'consumer'));
        if (retirement === 'workspace') h.dispatch(workspaceUnmounted('ws'));
        if (retirement === 'retire') h.dispatch(retireFileExplorer('ws'));
        if (retirement === 'root') context = 'other-root';
        if (retirement === 'open') h.dispatch(fileSearchOpened('ws', 'consumer', 'context'));
        expect(oldGuard()).toBe(false);
        h.dispatch(fileSearchOpened('ws', 'consumer', context));
        h.dispatch(fileSearchRequested('ws', 'consumer', 'same-id', 'new', context));
        await vi.advanceTimersByTimeAsync(50);
        old.resolve({ files: ['stale.ts'], truncated: false });
        await vi.advanceTimersByTimeAsync(500);
        expect(oldGuard()).toBe(false);
        expect(h.search()).toMatchObject({
          paths: ['current.ts'],
          query: 'new',
          loading: false,
          settled: true,
        });
        expect(h.actions.filter((action) => action.type === fileSearchSettled.type)).toHaveLength(
          1,
        );
      } finally {
        h.task.cancel();
        await h.task.toPromise();
      }
    },
  );

  it('prevents an old transport from dispatching after release and same-context remount', async () => {
    vi.useFakeTimers();
    const preflight = deferred<void>();
    const wire = vi.fn();
    const read = createBackendFileNameSearch(
      async <T>(
        _method: string,
        params: Record<string, unknown>,
        options?: { onDispatch?: () => void },
      ) => {
        if (params.pattern === 'old') await preflight.promise;
        options?.onDispatch?.();
        wire(params);
        return { files: ['current.ts'], requestId: 'wire-request', truncated: false } as T;
      },
    );
    const h = startSearch(read);
    try {
      h.dispatch(fileSearchRequested('ws', 'consumer', 'old', 'old', 'context'));
      await vi.advanceTimersByTimeAsync(50);
      h.dispatch(fileSearchReleased('ws', 'consumer'));
      h.dispatch(fileSearchOpened('ws', 'consumer', 'context'));
      h.dispatch(fileSearchRequested('ws', 'consumer', 'new', 'new', 'context'));
      preflight.resolve();
      await vi.advanceTimersByTimeAsync(550);
      expect(wire.mock.calls).toEqual([[{ workspaceId: 'ws', pattern: 'new', limit: 100 }]]);
      expect(h.search()?.paths).toEqual(['current.ts']);
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('fences late failure and publication when context changes during an in-flight read', async () => {
    vi.useFakeTimers();
    let context = 'context';
    const pending = deferred<FileNameSearchResult>();
    const h = startSearch(
      () => pending.promise,
      () => context,
    );
    try {
      h.dispatch(fileSearchRequested('ws', 'consumer', 'old', 'file', 'context'));
      await vi.advanceTimersByTimeAsync(50);
      context = 'replacement';
      pending.reject(new Error('old failure'));
      await vi.advanceTimersByTimeAsync(550);
      expect(h.actions.filter((action) => action.type === fileSearchSettled.type)).toEqual([]);
      expect(h.search()).toMatchObject({ error: null, loading: false, settled: false });
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });
});
