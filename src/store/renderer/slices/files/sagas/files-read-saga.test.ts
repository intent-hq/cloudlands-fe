import { runSaga, stdChannel } from 'redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { m } from '$shared/paraglide/messages.js';
import { updateFileTabPath } from '../../panel-layout/panel-layout-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
  removeFileContentEntry,
  filesReducer,
  initialState,
} from '../files-slice';
import type { FilesState } from '../files-types';
import { filesReadSaga, MAX_CONCURRENT_FILE_READS } from './files-read-saga';

vi.mock('$lib/client/live/backend-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/client/live/backend-transport')>();
  return { ...actual, backendRequest: vi.fn() };
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

type FileReadResult = Awaited<ReturnType<typeof appClient.files.read>>;
type FilesAction = Parameters<typeof filesReducer>[1];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fileResult(content: string): NonNullable<FileReadResult> {
  return { originalContent: content, localContent: null, isBinary: false, truncated: false };
}

function startStatefulSaga() {
  const channel = stdChannel();
  const actions: FilesAction[] = [];
  let state: FilesState = initialState;
  const reduce = (action: FilesAction) => {
    state = filesReducer(state, action);
  };
  const task = runSaga(
    {
      channel,
      dispatch: (action) => {
        const filesAction = action as FilesAction;
        actions.push(filesAction);
        reduce(filesAction);
      },
    },
    filesReadSaga,
  );
  return {
    actions,
    task,
    send(action: FilesAction) {
      reduce(action);
      channel.put(action);
    },
    entry(workspaceId: string, path: string) {
      const workspace = state.byWorkspaceId[workspaceId];
      return workspace ? getItem(workspace.files, path) : undefined;
    },
    state: () => state,
  };
}

describe('filesReadSaga', () => {
  afterEach(() => {
    vi.mocked(backendRequest).mockReset();
    vi.restoreAllMocks();
  });

  it('uses the exact request and maps only runtime content fields', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue({
      path: 'src/a.ts',
      absolutePath: '/repo/src/a.ts',
      originalContent: 'hello',
      localContent: 'stale',
      lastUpdated: 99,
      loading: false,
      saving: false,
      error: null,
      isBinary: true,
      truncated: true,
      wireOnly: 'drop',
    } as never);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(
      loadFileContentRequested('ws-1', 'src/a.ts', '/repo/src/a.ts', {
        maxSize: 10,
        truncateIfLarge: true,
      }),
    );
    await settle();

    expect(appClient.files.read).toHaveBeenCalledWith('ws-1', 'src/a.ts');
    expect(actions).toEqual([
      loadFileContentSucceeded('ws-1', 'src/a.ts', '/repo/src/a.ts', 'hello', true, true),
    ]);
    expect(backendRequest).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('dispatches the exact failure action when the file is absent and no candidate matches', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    vi.mocked(backendRequest).mockResolvedValue({ files: ['src/other/missing.ts.bak'] });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(loadFileContentRequested('ws-1', 'missing.ts', '/repo/missing.ts'));
    await settle();

    expect(backendRequest).toHaveBeenCalledWith('search.fileNames', {
      workspaceId: 'ws-1',
      pattern: 'missing.ts',
      limit: 50,
    });
    expect(actions).toEqual([
      loadFileContentFailed(
        'ws-1',
        'missing.ts',
        '/repo/missing.ts',
        m.files_read_notFound_error(),
        [],
      ),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('retargets file tabs to the unique suffix match instead of failing', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    vi.mocked(backendRequest).mockResolvedValue({
      files: ['packages/intentd/crates/res/common.md', 'other/uncommon.md'],
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(
      loadFileContentRequested('ws-1', 'crates/res/common.md', '/repo/crates/res/common.md'),
    );
    await settle();

    expect(backendRequest).toHaveBeenCalledWith('search.fileNames', {
      workspaceId: 'ws-1',
      pattern: 'crates/res/common.md',
      limit: 50,
    });
    expect(actions).toEqual([
      removeFileContentEntry('ws-1', 'crates/res/common.md'),
      updateFileTabPath('ws-1', 'crates/res/common.md', 'packages/intentd/crates/res/common.md'),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('never surfaces the requested path itself as a candidate', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    vi.mocked(backendRequest).mockResolvedValue({ files: ['docs/guide.md'] });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(loadFileContentRequested('ws-1', 'docs/guide.md', '/repo/docs/guide.md'));
    await settle();

    expect(actions).toEqual([
      loadFileContentFailed(
        'ws-1',
        'docs/guide.md',
        '/repo/docs/guide.md',
        m.files_read_notFound_error(),
        [],
      ),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('filters the self-path out and retargets to the remaining unique match', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    vi.mocked(backendRequest).mockResolvedValue({
      files: ['docs/guide.md', 'packages/a/docs/guide.md'],
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(loadFileContentRequested('ws-1', 'docs/guide.md', '/repo/docs/guide.md'));
    await settle();

    expect(actions).toEqual([
      removeFileContentEntry('ws-1', 'docs/guide.md'),
      updateFileTabPath('ws-1', 'docs/guide.md', 'packages/a/docs/guide.md'),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not retarget on a single candidate when the search result was truncated', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    vi.mocked(backendRequest).mockResolvedValue({
      files: ['packages/intentd/crates/res/common.md'],
      truncated: true,
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(
      loadFileContentRequested('ws-1', 'crates/res/common.md', '/repo/crates/res/common.md'),
    );
    await settle();

    expect(actions).toEqual([
      loadFileContentFailed(
        'ws-1',
        'crates/res/common.md',
        '/repo/crates/res/common.md',
        m.files_read_notFound_error(),
        ['packages/intentd/crates/res/common.md'],
      ),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('keeps the failure state with all candidates when the match is ambiguous', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    vi.mocked(backendRequest).mockResolvedValue({
      files: ['packages/a/docs/guide.md', 'packages/b/docs/guide.md'],
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(loadFileContentRequested('ws-1', 'docs/guide.md', '/repo/docs/guide.md'));
    await settle();

    expect(actions).toEqual([
      loadFileContentFailed(
        'ws-1',
        'docs/guide.md',
        '/repo/docs/guide.md',
        m.files_read_notFound_error(),
        ['packages/a/docs/guide.md', 'packages/b/docs/guide.md'],
      ),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('retargets an ignored media basename only when direct artifact listing is unique', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    vi.spyOn(appClient.files, 'listDirectory').mockImplementation(async (_workspaceId, path) => {
      if (path === '.demo-artifacts') {
        return [{ name: 'saved-run', path: 'saved-run', type: 'directory' }];
      }
      if (path === '.demo-artifacts/saved-run') {
        return [{ name: 'preview.webm', path: 'preview.webm', type: 'file' }];
      }
      return [];
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(loadFileContentRequested('ws-1', 'preview.webm', '/repo/preview.webm'));
    await settle();

    expect(actions).toEqual([
      removeFileContentEntry('ws-1', 'preview.webm'),
      updateFileTabPath('ws-1', 'preview.webm', '.demo-artifacts/saved-run/preview.webm'),
    ]);
    expect(backendRequest).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('reports the missing hover-card MP4 without a broad filename search or false candidate', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    vi.spyOn(appClient.files, 'listDirectory').mockResolvedValue([]);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);
    const path = 'artifacts/workspace-hover-card-demo/hover-card-demo.mp4';

    channel.put(loadFileContentRequested('ws-1', path, `/repo/${path}`));
    await settle();

    expect(actions).toEqual([
      loadFileContentFailed('ws-1', path, `/repo/${path}`, m.files_read_notFound_error(), []),
    ]);
    expect(backendRequest).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('runs different workspace:path keys independently and settles both stores', async () => {
    const first = deferred<FileReadResult>();
    const second = deferred<FileReadResult>();
    vi.spyOn(appClient.files, 'read')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const run = startStatefulSaga();

    run.send(loadFileContentRequested('ws-1', 'src/a.ts', '/repo/src/a.ts'));
    run.send(loadFileContentRequested('ws-2', 'src/b.ts', '/repo/src/b.ts'));
    await settle();

    expect(appClient.files.read).toHaveBeenNthCalledWith(1, 'ws-1', 'src/a.ts');
    expect(appClient.files.read).toHaveBeenNthCalledWith(2, 'ws-2', 'src/b.ts');
    second.resolve(fileResult('B'));
    first.resolve(fileResult('A'));
    await settle();

    expect(run.entry('ws-1', 'src/a.ts')).toMatchObject({ loading: false, localContent: 'A' });
    expect(run.entry('ws-2', 'src/b.ts')).toMatchObject({ loading: false, localContent: 'B' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('collapses identical busy-key requests into one latest trailing read', async () => {
    const leading = deferred<FileReadResult>();
    const trailing = deferred<FileReadResult>();
    vi.spyOn(appClient.files, 'read')
      .mockReturnValueOnce(leading.promise)
      .mockReturnValueOnce(trailing.promise);
    const run = startStatefulSaga();
    const request = () => loadFileContentRequested('ws-1', 'src/a.ts', '/repo/src/a.ts');

    run.send(request());
    run.send(request());
    run.send(request());
    await settle();
    expect(appClient.files.read).toHaveBeenCalledTimes(1);

    leading.resolve(fileResult('stale'));
    await vi.waitFor(() => expect(appClient.files.read).toHaveBeenCalledTimes(2));
    expect(run.actions).toEqual([]);
    trailing.resolve(fileResult('latest'));
    await settle();

    expect(appClient.files.read).toHaveBeenNthCalledWith(1, 'ws-1', 'src/a.ts');
    expect(appClient.files.read).toHaveBeenNthCalledWith(2, 'ws-1', 'src/a.ts');
    expect(run.actions).toEqual([
      loadFileContentSucceeded('ws-1', 'src/a.ts', '/repo/src/a.ts', 'latest', false, false),
    ]);
    expect(run.entry('ws-1', 'src/a.ts')).toMatchObject({ loading: false, localContent: 'latest' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retargets the same key to the latest absolutePath without landing stale content', async () => {
    const leading = deferred<FileReadResult>();
    const trailing = deferred<FileReadResult>();
    vi.spyOn(appClient.files, 'read')
      .mockReturnValueOnce(leading.promise)
      .mockReturnValueOnce(trailing.promise);
    const run = startStatefulSaga();

    run.send(loadFileContentRequested('ws-1', 'src/a.ts', '/old/src/a.ts'));
    run.send(loadFileContentRequested('ws-1', 'src/a.ts', '/new/src/a.ts'));
    leading.resolve(fileResult('old'));
    await vi.waitFor(() => expect(appClient.files.read).toHaveBeenCalledTimes(2));
    trailing.resolve(fileResult('new'));
    await settle();

    expect(appClient.files.read).toHaveBeenNthCalledWith(1, 'ws-1', 'src/a.ts');
    expect(appClient.files.read).toHaveBeenNthCalledWith(2, 'ws-1', 'src/a.ts');
    expect(run.actions).toEqual([
      loadFileContentSucceeded('ws-1', 'src/a.ts', '/new/src/a.ts', 'new', false, false),
    ]);
    expect(run.entry('ws-1', 'src/a.ts')).toMatchObject({
      absolutePath: '/new/src/a.ts',
      localContent: 'new',
      loading: false,
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('suppresses a leading failure and settles the queued trailing retry', async () => {
    const leading = deferred<FileReadResult>();
    const trailing = deferred<FileReadResult>();
    vi.spyOn(appClient.files, 'read')
      .mockReturnValueOnce(leading.promise)
      .mockReturnValueOnce(trailing.promise);
    const run = startStatefulSaga();

    run.send(loadFileContentRequested('ws-1', 'src/a.ts', '/repo/src/a.ts'));
    run.send(loadFileContentRequested('ws-1', 'src/a.ts', '/repo/src/a.ts'));
    leading.reject(new Error('stale failure'));
    await vi.waitFor(() => expect(appClient.files.read).toHaveBeenCalledTimes(2));
    expect(run.actions).toEqual([]);
    trailing.resolve(fileResult('recovered'));
    await settle();

    expect(appClient.files.read).toHaveBeenNthCalledWith(1, 'ws-1', 'src/a.ts');
    expect(appClient.files.read).toHaveBeenNthCalledWith(2, 'ws-1', 'src/a.ts');
    expect(run.actions).toEqual([
      loadFileContentSucceeded('ws-1', 'src/a.ts', '/repo/src/a.ts', 'recovered', false, false),
    ]);
    expect(run.entry('ws-1', 'src/a.ts')).toMatchObject({
      loading: false,
      error: null,
      localContent: 'recovered',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not apply a stale suffix retarget after a newer request', async () => {
    const suffix = deferred<{ files: string[] }>();
    vi.spyOn(appClient.files, 'read')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fileResult('latest'));
    vi.mocked(backendRequest).mockReturnValueOnce(suffix.promise);
    const run = startStatefulSaga();

    run.send(loadFileContentRequested('ws-1', 'docs/guide.md', '/old/docs/guide.md'));
    await vi.waitFor(() => expect(backendRequest).toHaveBeenCalledTimes(1));
    run.send(loadFileContentRequested('ws-1', 'docs/guide.md', '/new/docs/guide.md'));
    suffix.resolve({ files: ['packages/a/docs/guide.md'] });
    await vi.waitFor(() => expect(appClient.files.read).toHaveBeenCalledTimes(2));
    await settle();

    expect(appClient.files.read).toHaveBeenNthCalledWith(1, 'ws-1', 'docs/guide.md');
    expect(appClient.files.read).toHaveBeenNthCalledWith(2, 'ws-1', 'docs/guide.md');
    expect(backendRequest).toHaveBeenCalledWith('search.fileNames', {
      workspaceId: 'ws-1',
      pattern: 'docs/guide.md',
      limit: 50,
    });
    expect(run.actions).toEqual([
      loadFileContentSucceeded(
        'ws-1',
        'docs/guide.md',
        '/new/docs/guide.md',
        'latest',
        false,
        false,
      ),
    ]);
    expect(run.entry('ws-1', 'docs/guide.md')).toMatchObject({
      absolutePath: '/new/docs/guide.md',
      localContent: 'latest',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels a leading read and clears its key state on workspace unmount', async () => {
    const leading = deferred<FileReadResult>();
    vi.spyOn(appClient.files, 'read').mockReturnValueOnce(leading.promise);
    const run = startStatefulSaga();

    run.send(loadFileContentRequested('ws-1', 'src/a.ts', '/repo/src/a.ts'));
    await vi.waitFor(() => expect(appClient.files.read).toHaveBeenCalledTimes(1));
    run.send(workspaceUnmounted('ws-1'));
    leading.resolve(fileResult('late'));
    await settle();

    expect(appClient.files.read).toHaveBeenCalledWith('ws-1', 'src/a.ts');
    expect(run.actions).toEqual([]);
    expect(run.state().byWorkspaceId['ws-1']).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels an active trailing read and clears its key state on workspace unmount', async () => {
    const leading = deferred<FileReadResult>();
    const trailing = deferred<FileReadResult>();
    vi.spyOn(appClient.files, 'read')
      .mockReturnValueOnce(leading.promise)
      .mockReturnValueOnce(trailing.promise);
    const run = startStatefulSaga();

    run.send(loadFileContentRequested('ws-1', 'src/a.ts', '/old/src/a.ts'));
    run.send(loadFileContentRequested('ws-1', 'src/a.ts', '/new/src/a.ts'));
    leading.resolve(fileResult('stale'));
    await vi.waitFor(() => expect(appClient.files.read).toHaveBeenCalledTimes(2));
    run.send(workspaceUnmounted('ws-1'));
    trailing.resolve(fileResult('late'));
    await settle();

    expect(appClient.files.read).toHaveBeenNthCalledWith(1, 'ws-1', 'src/a.ts');
    expect(appClient.files.read).toHaveBeenNthCalledWith(2, 'ws-1', 'src/a.ts');
    expect(run.actions).toEqual([]);
    expect(run.state().byWorkspaceId['ws-1']).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retires permit-queued keys before unmount releases active permits', async () => {
    const reads = Array.from({ length: MAX_CONCURRENT_FILE_READS }, () =>
      deferred<FileReadResult>(),
    );
    vi.spyOn(appClient.files, 'read').mockImplementation((_workspaceId, path) => {
      const index = Number(path.slice(5, -3));
      return reads[index].promise;
    });
    const run = startStatefulSaga();

    for (let index = 0; index <= MAX_CONCURRENT_FILE_READS; index += 1) {
      run.send(loadFileContentRequested('ws-1', `file-${index}.ts`, `/repo/file-${index}.ts`));
    }
    await settle();
    expect(appClient.files.read).toHaveBeenCalledTimes(MAX_CONCURRENT_FILE_READS);

    run.send(workspaceUnmounted('ws-1'));
    for (let index = 0; index < reads.length; index += 1) {
      reads[index].resolve(fileResult(String(index)));
    }
    await settle();

    expect(appClient.files.read).toHaveBeenCalledTimes(MAX_CONCURRENT_FILE_READS);
    expect(run.actions).toEqual([]);
    expect(run.state().byWorkspaceId['ws-1']).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('caps distinct in-flight file reads and admits queued work as a permit frees', async () => {
    const reads = Array.from({ length: MAX_CONCURRENT_FILE_READS + 1 }, () =>
      deferred<FileReadResult>(),
    );
    vi.spyOn(appClient.files, 'read').mockImplementation((_workspaceId, path) => {
      const index = Number(path.slice(5, -3));
      return reads[index].promise;
    });
    const run = startStatefulSaga();

    for (let index = 0; index < reads.length; index += 1) {
      run.send(loadFileContentRequested('ws-1', `file-${index}.ts`, `/repo/file-${index}.ts`));
    }
    await settle();
    expect(appClient.files.read).toHaveBeenCalledTimes(MAX_CONCURRENT_FILE_READS);

    reads[0].resolve(fileResult('zero'));
    await vi.waitFor(() =>
      expect(appClient.files.read).toHaveBeenCalledTimes(MAX_CONCURRENT_FILE_READS + 1),
    );
    expect(appClient.files.read).toHaveBeenLastCalledWith(
      'ws-1',
      `file-${MAX_CONCURRENT_FILE_READS}.ts`,
    );

    run.task.cancel();
    await run.task.toPromise();
  });
});
