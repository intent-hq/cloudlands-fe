import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { createFileRequested } from '../../app-layout/app-layout-slice';
import {
  fileExplorerReducer,
  setFileExplorerWorkspacePath,
} from '../../file-explorer/file-explorer-slice';
import { refreshDirectoryRequested } from '../../file-explorer/file-explorer-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { openWorkspaceFile } from '../../workspace-navigation/workspace-navigation-slice';
import {
  filesReducer,
  loadFileContentSucceeded,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  updateFileContent,
} from '../files-slice';
import { FILE_CONTENT_SAVE_DEBOUNCE_MS, filesWriteSaga } from './files-write-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('filesWriteSaga', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes a create request then refreshes and opens in order', async () => {
    vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: true });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const fileExplorer = fileExplorerReducer(
      undefined,
      setFileExplorerWorkspacePath('ws-1', '/repo'),
    );
    const task = runSaga(
      {
        channel,
        getState: () => ({ fileExplorer }),
        dispatch: (action) => actions.push(action),
      },
      filesWriteSaga,
    );

    channel.put(createFileRequested('ws-1', '/repo/src', 'new.ts'));
    await settle();

    expect(appClient.files.write).toHaveBeenCalledWith('ws-1', 'src/new.ts', '');
    expect(actions).toEqual([
      refreshDirectoryRequested('ws-1', '/repo/src/new.ts'),
      openWorkspaceFile('ws-1', '/repo/src/new.ts'),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('debounces updates into one exact save request and result', async () => {
    vi.useFakeTimers();
    vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: true });
    const channel = stdChannel();
    const actions: unknown[] = [];
    let files = filesReducer(
      undefined,
      loadFileContentSucceeded('ws-1', 'a.ts', '/repo/a.ts', 'old'),
    );
    const dispatch = (action: Parameters<typeof filesReducer>[1]) => {
      files = filesReducer(files, action);
      actions.push(action);
      channel.put(action);
    };
    const task = runSaga({ channel, getState: () => ({ files }), dispatch }, filesWriteSaga);

    const update = updateFileContent('ws-1', 'a.ts', 'new');
    files = filesReducer(files, update);
    channel.put(update);
    await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS);
    await settle();

    expect(appClient.files.write).toHaveBeenCalledWith('ws-1', 'a.ts', 'new');
    expect(actions).toEqual([
      saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'new'),
      saveFileContentSucceeded('ws-1', 'a.ts', 'new'),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('serializes writes per file and keeps only the newest queued content', async () => {
    let resolveFirst!: (value: { success: boolean }) => void;
    const write = vi
      .spyOn(appClient.files, 'write')
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveFirst = done;
        }),
      )
      .mockResolvedValue({ success: true });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesWriteSaga);

    channel.put(saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'first'));
    channel.put(saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'second'));
    channel.put(saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'latest'));
    await settle();
    expect(write.mock.calls).toEqual([['ws-1', 'a.ts', 'first']]);

    resolveFirst({ success: true });
    await settle();
    await settle();
    expect(write.mock.calls).toEqual([
      ['ws-1', 'a.ts', 'first'],
      ['ws-1', 'a.ts', 'latest'],
    ]);
    expect(actions).toEqual([
      saveFileContentSucceeded('ws-1', 'a.ts', 'first'),
      saveFileContentSucceeded('ws-1', 'a.ts', 'latest'),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('maps a rejected mutation result to the exact failure action', async () => {
    vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: false, error: 'disk full' });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, filesWriteSaga);

    channel.put(saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'new'));
    await settle();

    expect(actions).toEqual([saveFileContentFailed('ws-1', 'a.ts', 'disk full')]);
    task.cancel();
    await task.toPromise();
  });

  it('cancels a pending debounce on workspace cleanup', async () => {
    vi.useFakeTimers();
    vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: true });
    const channel = stdChannel();
    let files = filesReducer(
      undefined,
      loadFileContentSucceeded('ws-1', 'a.ts', '/repo/a.ts', 'old'),
    );
    const task = runSaga(
      { channel, getState: () => ({ files }), dispatch: vi.fn() },
      filesWriteSaga,
    );
    const update = updateFileContent('ws-1', 'a.ts', 'new');
    files = filesReducer(files, update);
    channel.put(update);
    channel.put(workspaceUnmounted('ws-1'));

    await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS);
    expect(appClient.files.write).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('suppresses late save and create results after workspace cleanup', async () => {
    let resolveSave!: (value: { success: boolean }) => void;
    let resolveCreate!: (value: { success: boolean }) => void;
    vi.spyOn(appClient.files, 'write')
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveSave = done;
        }),
      )
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveCreate = done;
        }),
      );
    const channel = stdChannel();
    const actions: unknown[] = [];
    const fileExplorer = fileExplorerReducer(
      undefined,
      setFileExplorerWorkspacePath('ws-1', '/repo'),
    );
    const task = runSaga(
      {
        channel,
        getState: () => ({ fileExplorer }),
        dispatch: (action) => actions.push(action),
      },
      filesWriteSaga,
    );

    channel.put(saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'new'));
    channel.put(createFileRequested('ws-1', '/repo/src', 'new.ts'));
    await settle();
    channel.put(workspaceUnmounted('ws-1'));
    await settle();
    resolveSave({ success: true });
    resolveCreate({ success: true });
    await settle();

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });
});
