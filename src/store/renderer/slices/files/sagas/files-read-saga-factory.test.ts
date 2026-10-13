import type { StoreAction } from '@themislib/themis/types';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileRead } from '$lib/client/live/backend-file-read';
import { createFileListDirectory } from '$lib/client/live/backend-file-list-directory';
import { BackendError, type BackendTransport } from '$lib/client/live/backend-transport-types';
import {
  createFileSuffixResolver,
  type SuffixResolution,
} from '$lib/services/files/file-suffix-resolver';
import {
  filesReducer,
  initialState,
  loadFileContentRequested,
  loadFileContentSucceeded,
  removeFileContentEntry,
} from '../files-slice';
import { createFilesReadSaga, MAX_CONCURRENT_FILE_READS } from './files-read-saga-factory';
import { getFileContentEntry } from '../files-projections';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';

vi.mock('$lib/client', () => {
  throw new Error('Shared file reads must not load the source client');
});
vi.mock('$store/renderer/store', () => {
  throw new Error('Shared file reads must not load the Svelte Store');
});
vi.mock('$lib/client/live/backend-transport', () => {
  throw new Error('Shared file reads must use injected transport');
});

function fileReadError(detail: string): BackendError {
  return new BackendError({
    code: 'INTERNAL_ERROR',
    rpcCode: -32603,
    message: 'Internal error',
    data: detail,
  });
}

const tasks: Task[] = [];
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function start(
  options: {
    context?: string | null;
    onDispatch?: (action: StoreAction<unknown>) => void;
    onError?: (error: unknown) => void;
    resolveFileBySuffix?: (workspaceId: string, path: string) => Promise<SuffixResolution>;
  } = {},
) {
  const channel = stdChannel();
  const actions: StoreAction<unknown>[] = [];
  let state = initialState;
  let context = options.context === undefined ? 'authority-1' : options.context;
  const request = vi.fn<BackendTransport['request']>();
  const files = { read: createFileRead(request) };
  const onRetarget = vi.fn();
  const dispatch = (action: StoreAction<unknown>) => {
    state = filesReducer(state, action);
    actions.push(action);
    options.onDispatch?.(action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch },
    createFilesReadSaga({
      files,
      resolveFileBySuffix:
        options.resolveFileBySuffix ??
        createFileSuffixResolver({ request, listDirectory: createFileListDirectory(request) }),
      admission: { readCurrentContext: () => context, dispatch },
      onRetarget,
      onError: options.onError,
    }),
  );
  tasks.push(task);
  return {
    request,
    files,
    dispatch,
    actions,
    onRetarget,
    entry: (path = 'src/a.ts') => getFileContentEntry({ files: state }, 'ws-1', path),
    replaceContext: (value: string | null) => {
      context = value;
    },
    load: (path = 'src/a.ts') => dispatch(loadFileContentRequested('ws-1', path, `/repo/${path}`)),
    results: () => actions.filter((action) => action.type !== loadFileContentRequested.type),
  };
}

describe('createFilesReadSaga', () => {
  it('uses the injected file.read wire contract and canonical reducer/cache', async () => {
    const run = start();
    run.request.mockResolvedValue('from daemon');
    run.load();
    await settle();
    expect(run.request.mock.calls).toEqual([
      ['file.read', { workspaceId: 'ws-1', path: 'src/a.ts' }],
    ]);
    expect(run.entry()).toMatchObject({
      localContent: 'from daemon',
      originalContent: 'from daemon',
      loading: false,
      error: null,
    });
    expect(run.results()).toEqual([
      loadFileContentSucceeded(
        'ws-1',
        'src/a.ts',
        '/repo/src/a.ts',
        { kind: 'editable-text', content: 'from daemon' },
        false,
      ),
    ]);
  });

  it('preserves the read receiver and git-root request identity', async () => {
    const run = start();
    const normalizedRead = run.files.read;
    vi.spyOn(run.files, 'read').mockImplementation(function (this: typeof run.files, ...args) {
      expect(this).toBe(run.files);
      return normalizedRead(...args);
    });
    run.request.mockResolvedValue('root content');
    run.dispatch(
      loadFileContentRequested('ws-1', 'packages/a/src/a.ts', '/repo/packages/a/src/a.ts', {
        gitRoot: { id: 'root-a', relativePath: 'src/a.ts' },
      }),
    );
    await settle();
    expect(run.request.mock.calls).toEqual([
      ['file.read', { workspaceId: 'ws-1', path: 'src/a.ts', gitRootId: 'root-a' }],
    ]);
    expect(run.entry('packages/a/src/a.ts')?.localContent).toBe('root content');
  });

  it('does not admit requests with no current authority', async () => {
    const run = start({ context: null });
    run.load();
    await settle();
    expect(run.request).not.toHaveBeenCalled();
    expect(run.results()).toEqual([]);
  });

  it('captures authority before a permit queue and releases permits for new authority', async () => {
    const run = start();
    const reads = Array.from({ length: MAX_CONCURRENT_FILE_READS }, () => deferred<string>());
    reads.forEach((read) => run.request.mockReturnValueOnce(read.promise));
    for (let i = 0; i <= MAX_CONCURRENT_FILE_READS; i++) run.load(`file-${i}.ts`);
    expect(run.request).toHaveBeenCalledTimes(MAX_CONCURRENT_FILE_READS);
    run.replaceContext('authority-2');
    reads.forEach((read) => read.resolve('stale'));
    await settle();
    expect(run.request).toHaveBeenCalledTimes(MAX_CONCURRENT_FILE_READS);
    expect(run.results()).toEqual([]);
    run.request.mockResolvedValue('current');
    run.load('file-4.ts');
    await settle();
    expect(run.entry('file-4.ts')?.localContent).toBe('current');
  });

  it('captures trailing request authority when enqueued, not when the worker starts', async () => {
    const read = deferred<string>();
    const run = start();
    run.request.mockReturnValueOnce(read.promise);
    run.load();
    run.load();
    run.replaceContext('authority-2');
    read.resolve('stale');
    await settle();
    expect(run.request).toHaveBeenCalledTimes(1);
    expect(run.results()).toEqual([]);
    run.request.mockResolvedValue('new owner');
    run.load();
    await settle();
    expect(run.entry()?.localContent).toBe('new owner');
  });

  it.each(['success', 'failure', 'missing'] as const)(
    'discards late %s after authority replacement',
    async (outcome) => {
      const read = deferred<string>();
      const onError = vi.fn();
      const run = start({ onError });
      run.request.mockReturnValueOnce(read.promise);
      run.load();
      run.replaceContext('authority-2');
      if (outcome === 'failure') read.reject(fileReadError('Permission denied (os error 13)'));
      else if (outcome === 'missing')
        read.reject(fileReadError('No such file or directory (os error 2)'));
      else read.resolve('stale');
      await settle();
      expect(run.request).toHaveBeenCalledTimes(1);
      expect(run.results()).toEqual([]);
      expect(run.onRetarget).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('uses canonical search wire normalization and invokes host retarget navigation', async () => {
    const run = start();
    run.request
      .mockRejectedValueOnce(fileReadError('No such file or directory (os error 2)'))
      .mockResolvedValueOnce({ files: ['src/a.ts', 'packages/a/src/a.ts'], truncated: false });
    run.load();
    await settle();
    expect(run.request.mock.calls).toEqual([
      ['file.read', { workspaceId: 'ws-1', path: 'src/a.ts' }],
      ['search.fileNames', { workspaceId: 'ws-1', pattern: 'src/a.ts', limit: 50 }],
    ]);
    expect(run.results()).toEqual([removeFileContentEntry('ws-1', 'src/a.ts')]);
    expect(run.entry()).toBeUndefined();
    expect(run.onRetarget).toHaveBeenCalledExactlyOnceWith(
      'ws-1',
      'src/a.ts',
      'packages/a/src/a.ts',
    );
  });

  it('discards suffix results that settle after authority replacement', async () => {
    const suffix = deferred<unknown>();
    const run = start();
    run.request
      .mockRejectedValueOnce(fileReadError('No such file or directory (os error 2)'))
      .mockReturnValueOnce(suffix.promise);
    run.load();
    await settle();
    expect(run.request).toHaveBeenCalledTimes(2);
    run.replaceContext('authority-2');
    suffix.resolve({ files: ['packages/a/src/a.ts'], truncated: false });
    await settle();
    expect(run.results()).toEqual([]);
    expect(run.onRetarget).not.toHaveBeenCalled();
  });

  it('checks authority between cache removal and retarget navigation', async () => {
    const run = start({
      onDispatch: (action) => {
        if (action.type === removeFileContentEntry.type) run.replaceContext('authority-2');
      },
    });
    run.request
      .mockRejectedValueOnce(fileReadError('No such file or directory (os error 2)'))
      .mockResolvedValueOnce({ files: ['packages/a/src/a.ts'] });
    run.load();
    await settle();
    expect(run.results()).toEqual([removeFileContentEntry('ws-1', 'src/a.ts')]);
    expect(run.onRetarget).not.toHaveBeenCalled();
  });

  it('checks authority again after error reporting before publishing failure', async () => {
    const run = start({ onError: () => run.replaceContext('authority-2') });
    run.request.mockRejectedValueOnce(fileReadError('Permission denied (os error 13)'));
    run.load();
    await settle();
    expect(run.results()).toEqual([]);
  });

  it.each(['remove', 'unmount'] as const)(
    'keeps cancelled suffix traversal retired after %s and reopening the same file',
    async (cleanup) => {
      const listing = deferred<unknown>();
      const currentRead = deferred<string>();
      const run = start();
      run.request
        .mockRejectedValueOnce(fileReadError('No such file or directory (os error 2)'))
        .mockReturnValueOnce(listing.promise)
        .mockReturnValueOnce(currentRead.promise);
      run.load('preview.png');
      await settle();
      expect(run.request).toHaveBeenCalledTimes(2);

      run.dispatch(
        cleanup === 'remove'
          ? removeFileContentEntry('ws-1', 'preview.png')
          : workspaceUnmounted('ws-1'),
      );
      run.load('preview.png');
      listing.resolve([{ name: 'old-run', path: 'old-run', type: 'directory' }]);
      await settle();
      expect(run.request.mock.calls).toEqual([
        ['file.read', { workspaceId: 'ws-1', path: 'preview.png' }],
        ['file.list', { workspaceId: 'ws-1', path: '.demo-artifacts' }],
        ['file.read', { workspaceId: 'ws-1', path: 'preview.png' }],
      ]);
      currentRead.resolve('new read');
      await settle();
      expect(run.entry('preview.png')?.localContent).toBe('new read');
      expect(run.onRetarget).not.toHaveBeenCalled();
    },
  );
});
