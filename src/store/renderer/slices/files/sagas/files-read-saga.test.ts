import { runSaga, stdChannel } from 'redux-saga';
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
} from '../files-slice';
import { filesReadSaga } from './files-read-saga';

vi.mock('$lib/client/live/backend-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/client/live/backend-transport')>();
  return { ...actual, backendRequest: vi.fn() };
});

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

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

  it('globally suppresses a different file read and cancels late completion on cleanup', async () => {
    let resolve!: (entry: Awaited<ReturnType<typeof appClient.files.read>>) => void;
    vi.spyOn(appClient.files, 'read').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(loadFileContentRequested('ws-1', 'src/a.ts', '/repo/src/a.ts'));
    channel.put(loadFileContentRequested('ws-2', 'src/b.ts', '/repo/src/b.ts'));
    await settle();
    channel.put(workspaceUnmounted('ws-1'));
    resolve({ originalContent: 'late', localContent: null, isBinary: false, truncated: false });
    await settle();

    expect(appClient.files.read).toHaveBeenCalledTimes(1);
    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });
});
