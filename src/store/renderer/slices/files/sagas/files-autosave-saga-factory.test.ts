import { createChannelFromSelector } from '@themislib/themis/saga';
import { take } from 'typed-redux-saga';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileWrite } from '$lib/client/live/backend-file-write';
import type { FileWriteOptions } from '$lib/client/file-write-types';
import { reserveGitMutation } from '../../../utils/worktree-mutation-queue';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  getFileContentEntry,
  getFileSaveOperation,
  getFileSaveOperations,
} from '../files-projections';
import { selectFileContentEntry } from '../files-selectors';
import {
  deleteFileRequested,
  deleteFileWithUndoRequested,
  filesReducer,
  loadFileContentRequested,
  loadFileContentSucceeded,
  removeFileContentEntry,
  saveFileContentRequested,
  updateFileContent,
} from '../files-slice';
import { createFilesAutosaveSaga } from './files-autosave-saga-factory';
import { createFilesSaveSaga } from './files-save-saga-factory';

const text = (content: string) => ({ kind: 'editable-text' as const, content });
const tasks: ReturnType<typeof runSaga>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const task of tasks.splice(0)) task.cancel();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness({
  retirement = false,
  serializeSaves = false,
}: { retirement?: boolean; serializeSaves?: boolean } = {}) {
  const channel = stdChannel();
  const subscribers = new Set<() => void>();
  let state = { files: filesReducer(undefined, { type: 'init' }) };
  let authority: string | null = 'principal-1/view-1';
  let requestCount = 0;
  const actions: Parameters<typeof filesReducer>[1][] = [];
  const transport = vi.fn(
    async (
      _method: string,
      _params?: unknown,
      options?: Partial<FileWriteOptions>,
    ): Promise<unknown> => {
      options?.onDispatch?.();
      return { ok: true };
    },
  );
  const dispatch = (action: Parameters<typeof filesReducer>[1]) => {
    state = { files: filesReducer(state.files, action) };
    actions.push(action);
    for (const subscriber of subscribers) subscriber();
    channel.put(action);
    return action;
  };
  const captureAuthority = () => authority;
  const saveSaga = createFilesSaveSaga({
    files: { write: createFileWrite(transport as Parameters<typeof createFileWrite>[0]) },
    readEntries: (workspaceId) => {
      const entries = state.files.byWorkspaceId[workspaceId]?.files;
      return entries ? getItems(entries) : [];
    },
    resolveWorkspacePath: () => '/repo',
    admission: {
      captureAuthority,
      readOperation: (id) => getFileSaveOperation(state, id),
      readOperations: (workspaceId, path) => getFileSaveOperations(state, workspaceId, path),
      dispatch,
    },
  });
  const autosaveSaga = createFilesAutosaveSaga({
    selectFileContentEntry,
    admission: {
      captureAuthority,
      createRequestId: () => `autosave-${++requestCount}`,
      serializeSaves,
      ...(retirement
        ? {
            retirement: {
              captureScope: (workspaceId: string, path: string, absolutePath: string) => ({
                workspaceId,
                path,
                absolutePath,
              }),
              waitForRetirement: function* (scope: {
                workspaceId: string;
                path: string;
                absolutePath: string;
              }) {
                const changes = yield* createChannelFromSelector(
                  selectFileContentEntry,
                  scope.workspaceId,
                  scope.path,
                );
                try {
                  while (true) {
                    const { payload } = yield* take(changes);
                    if (payload?.absolutePath !== scope.absolutePath) return;
                  }
                } finally {
                  changes.close();
                }
              },
            },
          }
        : {}),
    },
  });
  const runtime = {
    channel,
    dispatch,
    getState: () => state,
    context: {
      reduxStore: {
        getState: () => state,
        subscribe: (subscriber: () => void) => {
          subscribers.add(subscriber);
          return () => subscribers.delete(subscriber);
        },
      },
    },
  };
  const saveTask = runSaga(runtime, saveSaga);
  const autosaveTask = runSaga(runtime, autosaveSaga);
  tasks.push(saveTask, autosaveTask);
  return {
    transport,
    dispatch,
    autosaveTask,
    subscriptionCount: () => subscribers.size,
    load: (content = 'old', absolutePath = '/repo/a.ts') =>
      dispatch(loadFileContentSucceeded('ws', 'a.ts', absolutePath, text(content))),
    edit: (content = 'edited', options?: { autoSave?: boolean }) =>
      dispatch(updateFileContent('ws', 'a.ts', text(content), options)),
    setAuthority: (next: string | null) => {
      authority = next;
    },
    entry: () => getFileContentEntry(state, 'ws', 'a.ts'),
    operation: (id = 'autosave-1') => getFileSaveOperation(state, id),
    saveRequests: () => actions.filter((action) => action.type === saveFileContentRequested.type),
  };
}

describe('shared autosave with host authority', () => {
  it('keeps the source first-edit delay, saves the latest bytes, and uses the existing save receipt', async () => {
    const h = harness();
    h.load();
    h.edit('first');
    await vi.advanceTimersByTimeAsync(750);
    h.edit('latest');
    await vi.advanceTimersByTimeAsync(749);
    expect(h.transport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.saveRequests()).toEqual([
      saveFileContentRequested('ws', 'a.ts', '/repo/a.ts', text('latest'), {
        requestId: 'autosave-1',
        authority: 'principal-1/view-1',
      }),
    ]);
    expect(h.transport).toHaveBeenCalledExactlyOnceWith(
      'file.write',
      {
        workspaceId: 'ws',
        path: 'a.ts',
        content: 'latest',
        idempotencyKey: expect.any(String),
      },
      { onDispatch: expect.any(Function) },
    );
    expect(h.entry()).toMatchObject({ originalContent: 'latest', localContent: 'latest' });
    expect(h.operation()?.status).toBe('succeeded');
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.transport).toHaveBeenCalledTimes(1);
  });

  it('permanently retires the original edit after same-turn root ABA through the selector channel', async () => {
    const h = harness({ retirement: true });
    h.load();
    h.edit();
    expect(h.subscriptionCount()).toBe(1);
    // Both observations arrive in the same turn: endpoint equality alone would admit the edit.
    h.load('other root', '/other/a.ts');
    h.load('old', '/repo/a.ts');
    expect(h.entry()).toMatchObject({ absolutePath: '/repo/a.ts', localContent: 'edited' });
    expect(h.subscriptionCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.saveRequests()).toEqual([]);
    expect(h.transport).not.toHaveBeenCalled();
    h.edit('fresh edit');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.entry()?.originalContent).toBe('fresh edit');
    expect(h.subscriptionCount()).toBe(0);
  });

  it('releases retirement observation on owner cancellation', () => {
    const h = harness({ retirement: true });
    h.load();
    h.edit();
    expect(h.subscriptionCount()).toBe(1);
    h.autosaveTask.cancel();
    expect(h.subscriptionCount()).toBe(0);
  });

  it('leaves an independently admitted explicit save alive when its autosave observation retires', async () => {
    const h = harness({ retirement: true });
    const reply = deferred<unknown>();
    h.transport.mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      return reply.promise;
    });
    h.load();
    h.edit();
    h.dispatch(
      saveFileContentRequested('ws', 'a.ts', '/repo/a.ts', text('edited'), {
        requestId: 'explicit-close',
        authority: 'principal-1/view-1',
      }),
    );
    expect(h.operation('explicit-close')?.status).toBe('running');
    expect(h.subscriptionCount()).toBe(0);
    h.autosaveTask.cancel();
    reply.reject(new Error('connection lost after dispatch'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.operation('explicit-close')?.status).toBe('uncertain');
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.saveRequests()).toHaveLength(1);
  });

  it('serializes a newer autosave after its timer expires during a held write', async () => {
    const h = harness({ serializeSaves: true });
    const first = deferred<unknown>();
    h.transport.mockImplementationOnce(async (_method, _params, options) => {
      options?.onDispatch?.();
      return first.promise;
    });
    h.load();
    h.edit('first');
    await vi.advanceTimersByTimeAsync(1500);
    h.edit('latest');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.operation('autosave-2')?.status).toBe('queued');
    first.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(h.entry()).toMatchObject({
      originalContent: 'latest',
      localContent: 'latest',
      saving: false,
    });
    expect(h.operation('autosave-2')?.status).toBe('succeeded');
  });

  it('saves a revert even when it matches the acknowledged baseline while a newer write is running', async () => {
    const h = harness({ serializeSaves: true });
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    h.transport.mockImplementationOnce(async (_method, _params, options) => {
      options?.onDispatch?.();
      return first.promise;
    });
    h.transport.mockImplementationOnce(async (_method, _params, options) => {
      options?.onDispatch?.();
      return second.promise;
    });
    h.load();
    h.edit('first');
    await vi.advanceTimersByTimeAsync(1500);
    h.edit('second');
    await vi.advanceTimersByTimeAsync(1500);
    first.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    h.edit('first');
    await vi.advanceTimersByTimeAsync(1500);
    const revertStatus = h.operation('autosave-3')?.status;
    second.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(revertStatus).toBe('queued');
    expect(h.transport).toHaveBeenCalledTimes(3);
    expect(h.entry()).toMatchObject({
      originalContent: 'first',
      localContent: 'first',
      saving: false,
    });
  });

  it('does not authorize an original edit retroactively after access is granted', async () => {
    const h = harness();
    h.load();
    h.setAuthority(null);
    h.edit();
    h.setAuthority('principal-1/view-1');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.saveRequests()).toEqual([]);
    expect(h.transport).not.toHaveBeenCalled();
    h.edit('fresh authorized edit');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.entry()?.originalContent).toBe('fresh authorized edit');
  });

  it('does not admit an edit while its original read is still loading', async () => {
    const h = harness();
    h.load();
    h.dispatch(loadFileContentRequested('ws', 'a.ts', '/repo/a.ts'));
    h.edit();
    h.load();
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.saveRequests()).toEqual([]);
    expect(h.transport).not.toHaveBeenCalled();
  });

  it.each([null, 'principal-2/view-1', 'principal-1/view-2'])(
    'rejects an edit when authority becomes %s before its delay expires',
    async (nextAuthority) => {
      const h = harness();
      h.load();
      h.edit();
      h.setAuthority(nextAuthority);
      await vi.advanceTimersByTimeAsync(1500);
      expect(h.saveRequests()).toEqual([]);
      expect(h.transport).not.toHaveBeenCalled();
      expect(h.entry()?.localContent).toBe('edited');
    },
  );

  it('does not retarget a pending edit to a replacement absolute path', async () => {
    const h = harness();
    h.load();
    h.edit();
    h.load('replacement', '/replacement/a.ts');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.saveRequests()).toEqual([]);
    expect(h.transport).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'file', 'owner'] as const)(
    'cancels the pending edit on %s departure even when the same authority is restored',
    async (departure) => {
      const h = harness();
      h.load();
      h.edit();
      await vi.advanceTimersByTimeAsync(750);
      if (departure === 'workspace') h.dispatch(workspaceUnmounted('ws'));
      else if (departure === 'file') h.dispatch(removeFileContentEntry('ws', 'a.ts'));
      else h.autosaveTask.cancel();
      h.load();
      h.edit('fresh edit');
      await vi.advanceTimersByTimeAsync(750);
      expect(h.saveRequests()).toEqual([]);
      expect(h.transport).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(750);
      expect(h.transport).toHaveBeenCalledTimes(departure === 'owner' ? 0 : 1);
    },
  );

  it.each(['manual-edit', 'delete', 'delete-with-undo'] as const)(
    'retains pending-autosave cancellation for %s',
    async (reason) => {
      const h = harness();
      h.load();
      h.edit();
      if (reason === 'manual-edit') h.edit('manual', { autoSave: false });
      else if (reason === 'delete')
        h.dispatch(deleteFileRequested('ws', '/repo/a.ts', { absolutePath: '/repo/a.ts' }));
      else
        h.dispatch(deleteFileWithUndoRequested('ws', '/repo/a.ts', { absolutePath: '/repo/a.ts' }));
      await vi.advanceTimersByTimeAsync(1500);
      expect(h.saveRequests()).toEqual([]);
      expect(h.transport).not.toHaveBeenCalled();
    },
  );

  it('keeps explicit save and later edits on the same canonical write owner', async () => {
    const h = harness();
    h.load();
    h.edit();
    h.dispatch(
      saveFileContentRequested('ws', 'a.ts', '/repo/a.ts', text('edited'), {
        requestId: 'manual',
        authority: 'principal-1/view-1',
      }),
    );
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.operation('manual')?.status).toBe('succeeded');
    h.edit('later');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(h.entry()?.originalContent).toBe('later');
  });

  it('rechecks the captured authority when the shared mutation queue admits a save', async () => {
    const h = harness();
    const lease = reserveGitMutation('ws');
    try {
      h.load();
      h.edit();
      await vi.advanceTimersByTimeAsync(1500);
      expect(h.operation()?.status).toBe('queued');
      h.setAuthority('principal-2/view-1');
      await lease.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.transport).not.toHaveBeenCalled();
      expect(h.operation()?.status).toBe('cancelled');
    } finally {
      await lease.release();
    }
  });

  it('retains an uncertain write receipt across departure and never replays it on a later edit', async () => {
    const h = harness();
    const reply = deferred<unknown>();
    h.transport.mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      return reply.promise;
    });
    h.load();
    h.edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.operation()?.status).toBe('running');
    h.dispatch(workspaceUnmounted('ws'));
    h.setAuthority('principal-1/view-2');
    reply.reject(new Error('socket closed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.operation()?.status).toBe('uncertain');
    h.load();
    h.edit('new edit');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.operation('autosave-2')?.status).toBe('cancelled');
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.entry()?.localContent).toBe('new edit');
    expect(h.entry()?.originalContent).toBe('old');
  });
});
