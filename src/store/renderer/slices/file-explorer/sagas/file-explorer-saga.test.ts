import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

import { appClient } from '$lib/client';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  addExpandedPath,
  addLoadingPath,
  clearFileExplorerForWorkspace,
  expandToPathRequested,
  fileExplorerReducer,
  initialState,
  initializeFileExplorer,
  refreshFileExplorer,
  removeLoadingPath,
  setFileExplorerInitialized,
  setFileExplorerLoading,
  setFileExplorerWorkspacePath,
  setRootNode,
} from '../file-explorer-slice';
import { fileExplorerSaga } from './file-explorer-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const root = {
  name: 'repo',
  path: '/repo',
  type: 'directory' as const,
  children: [{ name: 'src', path: '/repo/src', type: 'directory' as const, children: [] }],
};

describe('fileExplorerSaga', () => {
  afterEach(() => vi.restoreAllMocks());

  it('initializes from exact tree fields and anchors relative children', async () => {
    vi.spyOn(appClient.files, 'explorerTree').mockResolvedValue({
      name: '',
      path: '',
      type: 'directory',
      children: [{ name: 'src', path: 'src', type: 'directory', children: [], wireOnly: 'drop' }],
      wireOnly: 'drop',
    } as never);
    vi.spyOn(appClient.events, 'query').mockResolvedValue([]);
    const channel = stdChannel();
    const actions: unknown[] = [];
    let fileExplorer = initialState;
    const dispatch = (action: Parameters<typeof fileExplorerReducer>[1]) => {
      actions.push(action);
      fileExplorer = fileExplorerReducer(fileExplorer, action);
    };
    const task = runSaga(
      { channel, dispatch, getState: () => ({ fileExplorer }) },
      fileExplorerSaga,
    );

    channel.put(initializeFileExplorer('ws-1', { workspacePath: '/repo' }));
    await settle();

    expect(appClient.files.explorerTree).toHaveBeenCalledWith('ws-1');
    expect(actions).toEqual([
      setFileExplorerWorkspacePath('ws-1', '/repo'),
      setFileExplorerLoading('ws-1', true),
      setRootNode('ws-1', root),
      addExpandedPath('ws-1', '/repo'),
      setFileExplorerLoading('ws-1', false),
      setFileExplorerInitialized('ws-1', true),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cancels initialization before a late response can dispatch', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof appClient.files.explorerTree>>) => void;
    vi.spyOn(appClient.files, 'explorerTree').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    vi.spyOn(appClient.events, 'query').mockResolvedValue([]);
    const channel = stdChannel();
    const actions: unknown[] = [];
    let fileExplorer = initialState;
    const dispatch = (action: Parameters<typeof fileExplorerReducer>[1]) => {
      actions.push(action);
      fileExplorer = fileExplorerReducer(fileExplorer, action);
    };
    const task = runSaga(
      { channel, dispatch, getState: () => ({ fileExplorer }) },
      fileExplorerSaga,
    );

    channel.put(initializeFileExplorer('ws-1', { workspacePath: '/repo' }));
    await settle();
    channel.put(workspaceUnmounted('ws-1'));
    await settle();
    resolve({ name: '', path: '', type: 'directory', children: [] });
    await settle();

    expect(actions).toEqual([
      setFileExplorerWorkspacePath('ws-1', '/repo'),
      setFileExplorerLoading('ws-1', true),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('refreshes the root and expanded directories before agent metadata', async () => {
    const listDirectory = vi
      .spyOn(appClient.files, 'listDirectory')
      .mockResolvedValueOnce([{ name: 'src', path: 'src', type: 'directory', children: [] }])
      .mockResolvedValueOnce([{ name: 'a.ts', path: 'a.ts', type: 'file' }]);
    vi.spyOn(appClient.events, 'query').mockResolvedValue([]);
    let fileExplorer = fileExplorerReducer(
      undefined,
      setFileExplorerWorkspacePath('ws-1', '/repo'),
    );
    fileExplorer = fileExplorerReducer(fileExplorer, setRootNode('ws-1', root));
    fileExplorer = fileExplorerReducer(fileExplorer, addExpandedPath('ws-1', '/repo/src'));
    const channel = stdChannel();
    const actions: Parameters<typeof fileExplorerReducer>[1][] = [];
    const dispatch = (action: Parameters<typeof fileExplorerReducer>[1]) => {
      actions.push(action);
      fileExplorer = fileExplorerReducer(fileExplorer, action);
    };
    const task = runSaga(
      { channel, dispatch, getState: () => ({ fileExplorer }) },
      fileExplorerSaga,
    );

    channel.put(refreshFileExplorer('ws-1'));
    await settle();
    await settle();

    expect(listDirectory.mock.calls).toEqual([
      ['ws-1', ''],
      ['ws-1', 'src'],
    ]);
    expect(appClient.events.query).toHaveBeenCalledTimes(2);
    expect(actions.at(-1)).toEqual(setFileExplorerLoading('ws-1', false));
    task.cancel();
    await task.toPromise();
  });

  it('clears a cancelled directory load and settles the superseding expand request', async () => {
    vi.spyOn(appClient.files, 'listDirectory')
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce([{ name: 'a.ts', path: 'a.ts', type: 'file' }]);
    let fileExplorer = fileExplorerReducer(
      undefined,
      setFileExplorerWorkspacePath('ws-1', '/repo'),
    );
    fileExplorer = fileExplorerReducer(fileExplorer, setRootNode('ws-1', root));
    const channel = stdChannel();
    const actions: Parameters<typeof fileExplorerReducer>[1][] = [];
    const dispatch = (action: Parameters<typeof fileExplorerReducer>[1]) => {
      actions.push(action);
      fileExplorer = fileExplorerReducer(fileExplorer, action);
    };
    const task = runSaga(
      { channel, dispatch, getState: () => ({ fileExplorer }) },
      fileExplorerSaga,
    );

    channel.put(expandToPathRequested('ws-1', '/repo/src/'));
    await settle();
    channel.put(expandToPathRequested('ws-1', '/repo/src/'));
    await settle();
    await settle();

    const workspace = fileExplorer.byWorkspaceId['ws-1'];
    expect(appClient.files.listDirectory.mock.calls).toEqual([
      ['ws-1', 'src'],
      ['ws-1', 'src'],
    ]);
    expect(
      actions.filter(
        (action) => action.type === addLoadingPath.type || action.type === removeLoadingPath.type,
      ),
    ).toEqual([
      addLoadingPath('ws-1', '/repo/src'),
      removeLoadingPath('ws-1', '/repo/src'),
      addLoadingPath('ws-1', '/repo/src'),
      removeLoadingPath('ws-1', '/repo/src'),
    ]);
    expect(workspace.loadingPaths).toEqual([]);
    expect(workspace.isBulkOperation).toBe(false);
    expect(getItem(workspace.nodes, '/repo/src')?.children).toEqual(['/repo/src/a.ts']);
    expect(getItem(workspace.nodes, '/repo/src/a.ts')).toEqual({
      name: 'a.ts',
      path: '/repo/src/a.ts',
      type: 'file',
      children: [],
    });
    task.cancel();
    await task.toPromise();
  });

  it('does not recreate cleared workspace state when cleanup cancels a directory load', async () => {
    vi.spyOn(appClient.files, 'listDirectory').mockReturnValue(new Promise(() => undefined));
    let fileExplorer = fileExplorerReducer(
      undefined,
      setFileExplorerWorkspacePath('ws-1', '/repo'),
    );
    fileExplorer = fileExplorerReducer(fileExplorer, setRootNode('ws-1', root));
    const channel = stdChannel();
    const actions: Parameters<typeof fileExplorerReducer>[1][] = [];
    const dispatch = (action: Parameters<typeof fileExplorerReducer>[1]) => {
      actions.push(action);
      fileExplorer = fileExplorerReducer(fileExplorer, action);
    };
    const task = runSaga(
      { channel, dispatch, getState: () => ({ fileExplorer }) },
      fileExplorerSaga,
    );

    channel.put(expandToPathRequested('ws-1', '/repo/src/'));
    await settle();
    fileExplorer = fileExplorerReducer(fileExplorer, clearFileExplorerForWorkspace('ws-1'));
    const actionCountBeforeCleanup = actions.length;
    channel.put(workspaceUnmounted('ws-1'));
    await settle();

    expect(actions.slice(actionCountBeforeCleanup)).toEqual([]);
    expect(fileExplorer.byWorkspaceId).toEqual({});
    task.cancel();
    await task.toPromise();
  });
});
