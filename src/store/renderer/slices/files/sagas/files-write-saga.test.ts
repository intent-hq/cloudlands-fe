import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { LiveFilesClient } from '$lib/client/live/live-files-client';
import { notify } from '$lib/components/patterns/notify';
import { store as appStore } from '../../../store';
import { reserveGitMutation } from '../../../utils/worktree-mutation-queue';
import { closeTab, closeTabsByType } from '../../panel-layout/panel-layout-slice';
import { createFileRequested } from '../../app-layout/app-layout-slice';
import {
  fileExplorerReducer,
  setFileExplorerWorkspacePath,
} from '../../file-explorer/file-explorer-slice';
import { refreshDirectoryRequested } from '../../file-explorer/file-explorer-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { openWorkspaceFile } from '../../workspace-navigation/workspace-navigation-slice';
import { selectFileContentEntry } from '../files-selectors';
import {
  filesReducer,
  deleteFileRequested,
  deleteFileWithUndoRequested,
  restoreFileContentRequested,
  removeFileContentEntry,
  loadFileContentSucceeded,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  updateFileContent,
} from '../files-slice';
import { FILE_CONTENT_SAVE_DEBOUNCE_MS, filesWriteSaga } from './files-write-saga';

vi.mock('$lib/client/live/backend-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/client/live/backend-transport')>();
  return { ...actual, backendRequest: vi.fn() };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function startWrites() {
  const channel = stdChannel();
  const actions: Parameters<typeof filesReducer>[1][] = [];
  let files = filesReducer(undefined, { type: 'test/init' });
  const workspace = {
    workspaces: createCollection('id', [{ id: 'ws-1', worktreePath: '/repo' }]),
  };
  const fileExplorer = fileExplorerReducer(
    undefined,
    setFileExplorerWorkspacePath('ws-1', '/repo'),
  );
  const dispatch = (action: Parameters<typeof filesReducer>[1]) => {
    files = filesReducer(files, action);
    actions.push(action);
    channel.put(action);
    return action;
  };
  vi.spyOn(appStore, 'state', 'get').mockImplementation(
    () => ({ files, workspace, fileExplorer }) as never,
  );
  const task = runSaga(
    { channel, getState: () => ({ files, workspace, fileExplorer }), dispatch },
    filesWriteSaga,
  );
  return {
    task,
    dispatch,
    actions,
    entry: (ws = 'ws-1', path = 'a.ts') =>
      selectFileContentEntry.select({ files } as never, ws, path),
  };
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('filesWriteSaga', () => {
  beforeEach(() => {
    vi.spyOn(appStore, 'state', 'get').mockReturnValue({
      files: filesReducer(undefined, { type: 'test/init' }),
    } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(backendRequest).mockReset();
  });

  it.each([
    'autosave',
    'explicit',
    'queued',
    'queued alias',
    'queued then unmount',
    'queued then prune',
  ] as const)('blocks %s writes after a text-to-binary read', async (mode) => {
    vi.useFakeTimers();
    const write = vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: true });
    const h = startWrites();
    const path = mode === 'queued alias' ? '/repo/a.ts' : 'a.ts';
    const lease = mode.startsWith('queued') ? reserveGitMutation('ws-1') : null;
    try {
      await lease?.ready;
      h.dispatch(loadFileContentSucceeded('ws-1', path, '/repo/a.ts', 'text'));
      h.dispatch(updateFileContent('ws-1', path, 'unsaved draft'));
      if (lease) h.dispatch(saveFileContentRequested('ws-1', path, '/repo/a.ts', 'unsaved draft'));
      h.dispatch(loadFileContentSucceeded('ws-1', 'a.ts', '/repo/a.ts', null, true));
      if (mode === 'explicit')
        h.dispatch(saveFileContentRequested('ws-1', path, '/repo/a.ts', 'unsaved draft'));
      if (mode === 'queued then unmount') h.dispatch(workspaceUnmounted('ws-1'));
      if (mode === 'queued then prune') h.dispatch(removeFileContentEntry('ws-1', 'a.ts'));
      await lease?.release();
      await vi.advanceTimersByTimeAsync(2 * FILE_CONTENT_SAVE_DEBOUNCE_MS);
      expect(write).not.toHaveBeenCalled();
      if (!mode.startsWith('queued then'))
        expect(h.entry()).toMatchObject({
          isBinary: true,
          originalContent: null,
          localContent: null,
        });
    } finally {
      await lease?.release();
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it.each(
    ['panel', 'explorer'].flatMap((origin) =>
      [
        { kind: 'binary controls', content: '\b\u0001' },
        { kind: 'normal Unicode', content: '\ufeffHello café\r\n' },
        { kind: 'empty file', content: '' },
        { kind: 'invalid UTF-8', content: null },
      ].map((sample) => ({ origin, ...sample })),
    ),
  )('preserves bytes for $origin Delete and Undo of $kind', async ({ origin, content }) => {
    vi.useFakeTimers();
    const warning = vi.spyOn(notify, 'warning').mockReturnValue('undo-toast');
    const error = vi.spyOn(notify, 'error').mockReturnValue('error-toast');
    vi.spyOn(notify, 'dismiss').mockImplementation(() => undefined);
    const client = new LiveFilesClient();
    vi.spyOn(appClient.files, 'read').mockImplementation(client.read.bind(client));
    vi.spyOn(appClient.files, 'delete').mockImplementation(client.delete.bind(client));
    vi.spyOn(appClient.files, 'write').mockImplementation(client.write.bind(client));
    const original =
      content === null ? new Uint8Array([0xff, 0x80]) : new TextEncoder().encode(content);
    let disk: Uint8Array | undefined = original.slice();
    vi.mocked(backendRequest).mockImplementation(async (method, params) => {
      if (method === 'file.read') {
        if (content === null)
          throw new BackendError({
            code: 'INTERNAL_ERROR',
            rpcCode: -32603,
            message: 'Internal error',
            data: { detail: 'stream did not contain valid UTF-8' },
          });
        return content;
      }
      if (method === 'file.delete') {
        disk = undefined;
        return { ok: true };
      }
      disk = new TextEncoder().encode((params as { content: string }).content);
      return { ok: true };
    });
    const h = startWrites();
    vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(h.dispatch);
    try {
      const entry = origin === 'panel' ? await client.read('ws-1', 'a.ts') : null;
      h.dispatch(
        deleteFileWithUndoRequested('ws-1', 'a.ts', {
          absolutePath: '/repo/a.ts',
          ...(origin === 'panel' ? { content: entry!.localContent, tabId: 'tab-1' } : {}),
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      if (content === null) {
        expect(error).toHaveBeenCalledOnce();
        expect(warning).not.toHaveBeenCalled();
        expect(
          vi.mocked(backendRequest).mock.calls.some(([method]) => method === 'file.delete'),
        ).toBe(false);
      } else {
        expect(disk).toBeUndefined();
        expect(warning).toHaveBeenCalledOnce();
        await (warning.mock.calls[0][1]?.action as { onClick: () => Promise<void> }).onClick();
      }
      expect(disk).toEqual(original);
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('retains explicit-save mode and never overwrites an edit made during a direct save', async () => {
    vi.useFakeTimers();
    const pending = deferred<{ success: boolean }>();
    const write = vi
      .spyOn(appClient.files, 'write')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ success: true });
    const h = startWrites();
    try {
      h.dispatch(loadFileContentSucceeded('ws-1', 'a.ts', '/repo/a.ts', 'old'));
      h.dispatch(updateFileContent('ws-1', 'a.ts', 'earlier autosave draft'));
      h.dispatch(updateFileContent('ws-1', 'a.ts', 'manual', { autoSave: false }));
      await vi.advanceTimersByTimeAsync(2 * FILE_CONTENT_SAVE_DEBOUNCE_MS);
      expect(write).not.toHaveBeenCalled();
      h.dispatch(saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'manual'));
      h.dispatch(updateFileContent('ws-1', 'a.ts', 'newer'));
      pending.resolve({ success: true });
      await settle();
      expect(h.entry()).toMatchObject({ originalContent: 'manual', localContent: 'newer' });
      await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS);
      expect(write.mock.calls).toEqual([
        ['ws-1', 'a.ts', 'manual'],
        ['ws-1', 'a.ts', 'newer'],
      ]);
      expect(h.entry()).toMatchObject({ originalContent: 'newer', localContent: 'newer' });
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('keeps an unmounted transport in the alias queue while same-path writes in another workspace stay independent', async () => {
    const first = deferred<{ success: boolean }>();
    const write = vi
      .spyOn(appClient.files, 'write')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ success: true });
    const h = startWrites();
    try {
      h.dispatch(saveFileContentRequested('ws-1', '/repo/a.ts', '/repo/a.ts', 'first'));
      h.dispatch(saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'flush'));
      h.dispatch(workspaceUnmounted('ws-1'));
      h.dispatch(saveFileContentRequested('ws-1', '/repo/a.ts', '/repo/a.ts', 'remounted'));
      h.dispatch(saveFileContentRequested('ws-2', 'a.ts', '/two/a.ts', 'independent'));
      await settle();
      expect(write.mock.calls).toEqual([
        ['ws-1', 'a.ts', 'first'],
        ['ws-2', 'a.ts', 'independent'],
      ]);
      first.resolve({ success: true });
      await vi.waitFor(() =>
        expect(h.entry('ws-1', '/repo/a.ts')?.originalContent).toBe('remounted'),
      );
      expect(write.mock.calls).toEqual([
        ['ws-1', 'a.ts', 'first'],
        ['ws-2', 'a.ts', 'independent'],
        ['ws-1', 'a.ts', 'flush'],
        ['ws-1', 'a.ts', 'remounted'],
      ]);
      expect(h.actions.filter((a) => a.type === saveFileContentSucceeded.type)).toEqual([
        saveFileContentSucceeded('ws-2', 'a.ts', 'independent'),
        saveFileContentSucceeded('ws-1', '/repo/a.ts', 'remounted'),
      ]);
    } finally {
      first.resolve({ success: true });
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('serializes an absolute panel save before a relative tree delete and its undo snapshot', async () => {
    vi.useFakeTimers();
    const pending = deferred<void>();
    const warning = vi.spyOn(notify, 'warning').mockReturnValue('undo-toast');
    vi.spyOn(notify, 'dismiss').mockImplementation(() => undefined);
    const client = new LiveFilesClient();
    vi.spyOn(appClient.files, 'read').mockImplementation(client.read.bind(client));
    vi.spyOn(appClient.files, 'delete').mockImplementation(client.delete.bind(client));
    vi.spyOn(appClient.files, 'write').mockImplementation(client.write.bind(client));
    let disk: string | undefined = 'old disk';
    vi.mocked(backendRequest).mockImplementation(async (method, params) => {
      if (method === 'file.read') return disk;
      if (method === 'file.delete') {
        disk = undefined;
        return { ok: true, path: 'a.ts', deleted: true };
      }
      const content = (params as { content: string }).content;
      await pending.promise;
      disk = content;
      return { ok: true, path: 'a.ts', size: content.length };
    });
    const h = startWrites();
    vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(h.dispatch);
    try {
      h.dispatch(loadFileContentSucceeded('ws-1', '/repo/a.ts', '/repo/a.ts', 'old disk'));
      h.dispatch(saveFileContentRequested('ws-1', '/repo/a.ts', '/repo/a.ts', 'saved panel'));
      h.dispatch(updateFileContent('ws-1', '/repo/a.ts', 'unsaved draft'));
      h.dispatch(deleteFileWithUndoRequested('ws-1', 'a.ts', { absolutePath: '/repo/a.ts' }));
      await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS);
      expect(vi.mocked(backendRequest).mock.calls.map(([method]) => method)).toEqual([
        'file.write',
      ]);
      expect(warning).not.toHaveBeenCalled();

      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(warning).toHaveBeenCalledOnce();
      expect(disk).toBeUndefined();
      expect(h.entry('ws-1', '/repo/a.ts')).toBeUndefined();
      expect(h.entry()).toBeUndefined();

      const options = warning.mock.calls[0][1];
      await (options?.action as { onClick: () => Promise<void> }).onClick();
      await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS);
      expect(disk).toBe('saved panel');
      expect(vi.mocked(backendRequest).mock.calls).toEqual([
        [
          'file.write',
          {
            workspaceId: 'ws-1',
            path: 'a.ts',
            content: 'saved panel',
            idempotencyKey: expect.any(String),
          },
        ],
        ['file.read', { workspaceId: 'ws-1', path: 'a.ts' }],
        ['file.delete', { workspaceId: 'ws-1', path: 'a.ts' }],
        [
          'file.write',
          {
            workspaceId: 'ws-1',
            path: 'a.ts',
            content: 'saved panel',
            idempotencyKey: expect.any(String),
          },
        ],
      ]);
    } finally {
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it.each(['save', 'delete', 'restore', 'create'] as const)(
    'serializes %s across panel and tree path spellings',
    async (operation) => {
      const pending = deferred<{ success: boolean }>();
      const write = vi
        .spyOn(appClient.files, 'write')
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue({ success: true });
      const remove = vi.spyOn(appClient.files, 'delete').mockResolvedValue({ success: true });
      const h = startWrites();
      try {
        h.dispatch(
          saveFileContentRequested(
            'ws-1',
            operation === 'create' ? '/repo/a.ts' : 'a.ts',
            '/repo/a.ts',
            'first',
          ),
        );
        const next = {
          save: saveFileContentRequested('ws-1', '/repo/a.ts', '/repo/a.ts', 'next'),
          delete: deleteFileRequested('ws-1', '/repo/a.ts', {
            absolutePath: '/repo/a.ts',
            content: 'next',
          }),
          restore: restoreFileContentRequested('ws-1', '/repo/a.ts', '/repo/a.ts', 'next'),
          create: createFileRequested('ws-1', '/repo', 'a.ts'),
        }[operation];
        h.dispatch(next);
        await settle();
        expect(write.mock.calls).toEqual([['ws-1', 'a.ts', 'first']]);
        expect(remove).not.toHaveBeenCalled();
        pending.resolve({ success: true });
        await vi.waitFor(() => {
          if (operation === 'delete') expect(remove).toHaveBeenCalledOnce();
          else expect(write).toHaveBeenCalledTimes(2);
        });
        if (operation === 'delete') {
          expect(remove).toHaveBeenCalledWith('ws-1', 'a.ts');
          expect(h.entry()).toBeUndefined();
        } else {
          expect(write.mock.calls[1]).toEqual([
            'ws-1',
            'a.ts',
            operation === 'create' ? '' : 'next',
          ]);
          if (operation === 'create')
            expect(h.actions).toContainEqual(openWorkspaceFile('ws-1', '/repo/a.ts'));
          else
            expect(h.entry('ws-1', '/repo/a.ts')).toMatchObject({
              localContent: 'next',
              originalContent: 'next',
              saving: false,
            });
        }
      } finally {
        pending.resolve({ success: true });
        h.task.cancel();
        await h.task.toPromise();
        await settle();
      }
    },
  );

  it('keeps absolute save failures on the caller cache key and does not strip an outside-root prefix', async () => {
    const pending = deferred<{ success: boolean; error: string }>();
    const write = vi
      .spyOn(appClient.files, 'write')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ success: true });
    const h = startWrites();
    try {
      h.dispatch(saveFileContentRequested('ws-1', '/repo/a.ts', '/repo/a.ts', 'blocked'));
      h.dispatch(
        saveFileContentRequested('ws-1', '/repo-other/a.ts', '/repo-other/a.ts', 'outside'),
      );
      await settle();
      expect(write.mock.calls).toEqual([
        ['ws-1', 'a.ts', 'blocked'],
        ['ws-1', '/repo-other/a.ts', 'outside'],
      ]);
      expect(h.entry('ws-1', '/repo-other/a.ts')?.saving).toBe(false);
      pending.resolve({ success: false, error: 'disk full' });
      await vi.waitFor(() =>
        expect(h.entry('ws-1', '/repo/a.ts')).toMatchObject({ saving: false, error: 'disk full' }),
      );
      expect(h.entry()).toBeUndefined();
    } finally {
      pending.resolve({ success: false, error: 'disk full' });
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('deletes and restores through exact daemon requests and clears the draft before closing tabs', async () => {
    const client = new LiveFilesClient();
    vi.spyOn(appClient.files, 'read').mockImplementation(client.read.bind(client));
    vi.spyOn(appClient.files, 'delete').mockImplementation(client.delete.bind(client));
    vi.spyOn(appClient.files, 'write').mockImplementation(client.write.bind(client));
    vi.mocked(backendRequest).mockImplementation(async (method) =>
      method === 'file.read' ? { content: 'disk' } : { ok: true },
    );
    const h = startWrites();
    try {
      h.dispatch(loadFileContentSucceeded('ws-1', 'a.ts', '/repo/a.ts', 'old'));
      h.dispatch(updateFileContent('ws-1', 'a.ts', 'draft'));
      const deletion = deleteFileRequested('ws-1', 'a.ts', { absolutePath: '/repo/a.ts' });
      h.dispatch(deletion);
      await expect(deletion.promise).resolves.toBe('disk');
      expect(h.entry()).toBeUndefined();
      expect(h.actions.filter((a) => a.type === closeTabsByType.type)).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({ wsId: 'ws-1', matchValue: 'a.ts' }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({ wsId: 'ws-1', matchValue: '/repo/a.ts' }),
        }),
      ]);
      const restore = restoreFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'disk');
      h.dispatch(restore);
      await expect(restore.promise).resolves.toBeUndefined();
      expect(h.entry()).toMatchObject({ originalContent: 'disk', localContent: 'disk' });
      expect(vi.mocked(backendRequest).mock.calls).toEqual([
        ['file.read', { workspaceId: 'ws-1', path: 'a.ts' }],
        ['file.delete', { workspaceId: 'ws-1', path: 'a.ts' }],
        [
          'file.write',
          {
            workspaceId: 'ws-1',
            path: 'a.ts',
            content: 'disk',
            idempotencyKey: expect.any(String),
          },
        ],
      ]);
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('retains the draft on delete failure and rejects a cancelled delete without closing a remounted tab', async () => {
    const remove = vi
      .spyOn(appClient.files, 'delete')
      .mockResolvedValueOnce({ success: false, error: 'permission denied' });
    const h = startWrites();
    try {
      h.dispatch(loadFileContentSucceeded('ws-1', 'a.ts', '/repo/a.ts', 'draft'));
      const failure = deleteFileRequested('ws-1', 'a.ts', {
        absolutePath: '/repo/a.ts',
        content: 'draft',
        tabId: 'tab-1',
      });
      h.dispatch(failure);
      await expect(failure.promise).rejects.toThrow('permission denied');
      expect(h.entry()?.localContent).toBe('draft');
      const pending = deferred<{ success: boolean }>();
      remove.mockReturnValueOnce(pending.promise);
      const cancelled = deleteFileRequested('ws-1', 'a.ts', {
        absolutePath: '/repo/a.ts',
        content: 'draft',
        tabId: 'tab-1',
      });
      h.dispatch(cancelled);
      h.dispatch(workspaceUnmounted('ws-1'));
      await expect(cancelled.promise).rejects.toThrow();
      h.dispatch(loadFileContentSucceeded('ws-1', 'a.ts', '/repo/a.ts', 'remounted'));
      pending.resolve({ success: true });
      await settle();
      expect(h.entry()?.localContent).toBe('remounted');
      expect(h.actions.some((a) => a.type === closeTab.type)).toBe(false);
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('waits for undo failure before displaying an error and keeps the captured workspace identity', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(notify, 'warning').mockReturnValue('undo-toast');
    const error = vi.spyOn(notify, 'error').mockReturnValue('error-toast');
    const dismiss = vi.spyOn(notify, 'dismiss').mockImplementation(() => undefined);
    vi.spyOn(appClient.files, 'delete').mockResolvedValue({ success: true });
    const pending = deferred<{ success: boolean; error: string }>();
    const write = vi.spyOn(appClient.files, 'write').mockReturnValueOnce(pending.promise);
    const h = startWrites();
    vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(h.dispatch);
    try {
      h.dispatch(
        deleteFileWithUndoRequested('ws-1', 'a.ts', {
          absolutePath: '/repo/a.ts',
          content: 'draft',
          tabId: 'tab-1',
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(warning).toHaveBeenCalledOnce();
      h.dispatch(workspaceUnmounted('ws-1'));
      const options = warning.mock.calls[0][1];
      const undo = (options?.action as { onClick: () => Promise<void> }).onClick();
      expect(write).toHaveBeenCalledWith('ws-1', 'a.ts', 'draft');
      expect(error).not.toHaveBeenCalled();
      pending.resolve({ success: false, error: 'disk full' });
      await undo;
      expect(error).toHaveBeenCalledOnce();
      expect(dismiss).not.toHaveBeenCalled();
      expect(h.entry()).toBeUndefined();
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
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

  it('persists updates for distinct paths inside the debounce window', async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: true });
    const channel = stdChannel();
    const actions: unknown[] = [];
    let files = filesReducer(
      undefined,
      loadFileContentSucceeded('ws-1', 'a.ts', '/repo/a.ts', 'old'),
    );
    files = filesReducer(files, loadFileContentSucceeded('ws-1', 'b.ts', '/repo/b.ts', 'old'));
    const dispatch = (action: Parameters<typeof filesReducer>[1]) => {
      files = filesReducer(files, action);
      actions.push(action);
      channel.put(action);
    };
    vi.spyOn(appStore, 'state', 'get').mockImplementation(() => ({ files }) as never);
    const task = runSaga({ channel, getState: () => ({ files }), dispatch }, filesWriteSaga);

    const first = updateFileContent('ws-1', 'a.ts', 'first');
    files = filesReducer(files, first);
    channel.put(first);
    await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS / 2);
    const second = updateFileContent('ws-1', 'b.ts', 'second');
    files = filesReducer(files, second);
    channel.put(second);
    await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS);
    await settle();

    expect(write.mock.calls).toEqual([
      ['ws-1', 'a.ts', 'first'],
      ['ws-1', 'b.ts', 'second'],
    ]);
    expect(actions).toEqual([
      saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'first'),
      saveFileContentSucceeded('ws-1', 'a.ts', 'first'),
      saveFileContentRequested('ws-1', 'b.ts', '/repo/b.ts', 'second'),
      saveFileContentSucceeded('ws-1', 'b.ts', 'second'),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists the latest content for rapid updates to the same path', async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: true });
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
    vi.spyOn(appStore, 'state', 'get').mockImplementation(() => ({ files }) as never);
    const task = runSaga({ channel, getState: () => ({ files }), dispatch }, filesWriteSaga);

    const first = updateFileContent('ws-1', 'a.ts', 'first');
    files = filesReducer(files, first);
    channel.put(first);
    await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS / 2);
    const latest = updateFileContent('ws-1', 'a.ts', 'latest');
    files = filesReducer(files, latest);
    channel.put(latest);
    await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS / 2);
    await settle();

    expect(write.mock.calls).toEqual([['ws-1', 'a.ts', 'latest']]);
    expect(actions).toEqual([
      saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'latest'),
      saveFileContentSucceeded('ws-1', 'a.ts', 'latest'),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('serializes same-path critical saves while different paths remain concurrent', async () => {
    let resolveFirst!: (value: { success: boolean }) => void;
    const firstWrite = new Promise<{ success: boolean }>((done) => {
      resolveFirst = done;
    });
    const write = vi.spyOn(appClient.files, 'write').mockImplementation((wsId, path, content) => {
      if (wsId === 'ws-1' && path === 'a.ts' && content === 'first') return firstWrite;
      return Promise.resolve({ success: true });
    });
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
    vi.spyOn(appStore, 'state', 'get').mockImplementation(() => ({ files }) as never);
    const task = runSaga({ channel, getState: () => ({ files }), dispatch }, filesWriteSaga);

    const first = saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'first');
    files = filesReducer(files, updateFileContent('ws-1', 'a.ts', 'first'));
    files = filesReducer(files, first);
    channel.put(first);
    const latest = saveFileContentRequested('ws-1', 'a.ts', '/repo/a.ts', 'latest');
    files = filesReducer(files, updateFileContent('ws-1', 'a.ts', 'latest'));
    files = filesReducer(files, latest);
    channel.put(latest);
    channel.put(saveFileContentRequested('ws-2', 'b.ts', '/repo/b.ts', 'other'));
    await settle();
    expect(write.mock.calls).toEqual([
      ['ws-1', 'a.ts', 'first'],
      ['ws-2', 'b.ts', 'other'],
    ]);
    expect(actions).toEqual([saveFileContentSucceeded('ws-2', 'b.ts', 'other')]);

    resolveFirst({ success: true });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(actions).toHaveLength(3));
    expect(write.mock.calls).toEqual([
      ['ws-1', 'a.ts', 'first'],
      ['ws-2', 'b.ts', 'other'],
      ['ws-1', 'a.ts', 'latest'],
    ]);
    expect(actions).toEqual([
      saveFileContentSucceeded('ws-2', 'b.ts', 'other'),
      saveFileContentSucceeded('ws-1', 'a.ts', 'first'),
      saveFileContentSucceeded('ws-1', 'a.ts', 'latest'),
    ]);
    expect(selectFileContentEntry.select({ files } as any, 'ws-1', 'a.ts')).toMatchObject({
      originalContent: 'latest',
      localContent: 'latest',
    });
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
