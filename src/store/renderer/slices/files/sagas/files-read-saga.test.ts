import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { m } from '$shared/paraglide/messages.js';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
} from '../files-slice';
import { filesReadSaga } from './files-read-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('filesReadSaga', () => {
  afterEach(() => vi.restoreAllMocks());

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
    task.cancel();
    await task.toPromise();
  });

  it('dispatches the exact failure action when the file is absent', async () => {
    vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    channel.put(loadFileContentRequested('ws-1', 'missing.ts', '/repo/missing.ts'));
    await settle();

    expect(actions).toEqual([
      loadFileContentFailed(
        'ws-1',
        'missing.ts',
        '/repo/missing.ts',
        m.files_read_notFound_error(),
      ),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('coalesces keyed reads and cancels late completion on workspace cleanup', async () => {
    let resolve!: (entry: Awaited<ReturnType<typeof appClient.files.read>>) => void;
    vi.spyOn(appClient.files, 'read').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesReadSaga);

    const request = loadFileContentRequested('ws-1', 'src/a.ts', '/repo/src/a.ts');
    channel.put(request);
    channel.put(request);
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
