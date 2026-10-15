import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileWrite } from '$lib/client/live/backend-file-write';
import { BackendError } from '$lib/client/live/backend-transport-types';
import type { FileWriteOptions } from '$lib/client/file-write-types';
import { reserveGitMutation } from '../../../utils/worktree-mutation-queue';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  getFileContentEntry,
  getFileSaveOperation,
  getFileSaveOperations,
} from '../files-projections';
import {
  filesReducer,
  loadFileContentSucceeded,
  loadFileContentRequested,
  loadFileContentFailed,
  removeFileContentEntry,
  saveFileContentRequested,
  updateFileContent,
} from '../files-slice';
import { createFilesSaveSaga } from './files-save-saga-factory';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const tasks: ReturnType<typeof runSaga>[] = [];
afterEach(() => {
  for (const task of tasks.splice(0)) task.cancel();
});
const text = (content: string) => ({ kind: 'editable-text' as const, content });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function harness({
  maxBytes,
  stablePublication = false,
}: { maxBytes?: number; stablePublication?: boolean } = {}) {
  const channel = stdChannel();
  let state = { files: filesReducer(undefined, { type: 'init' }) };
  let authority: string | null = 'epoch-1';
  let publicationAuthority: string | null = 'principal-backend-root-1';
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
    channel.put(action);
    return action;
  };
  const saga = createFilesSaveSaga({
    files: { write: createFileWrite(transport as Parameters<typeof createFileWrite>[0]) },
    readEntries: (workspaceId) =>
      state.files.byWorkspaceId[workspaceId]
        ? getItems(state.files.byWorkspaceId[workspaceId].files)
        : [],
    resolveWorkspacePath: () => '/repo',
    maxBytes,
    admission: {
      captureAuthority: () => authority,
      ...(stablePublication ? { capturePublicationAuthority: () => publicationAuthority } : {}),
      readOperation: (requestId) => getFileSaveOperation(state, requestId),
      readOperations: (workspaceId, path) => getFileSaveOperations(state, workspaceId, path),
      dispatch,
    },
  });
  const task = runSaga({ channel, dispatch, getState: () => state }, saga);
  tasks.push(task);
  const load = (content = 'old') =>
    dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text(content)));
  const edit = (content: string) =>
    dispatch(updateFileContent('ws', 'a.ts', text(content), { autoSave: false }));
  const save = (
    requestId = 'request-1',
    content = 'new',
    requestAuthority = authority ?? 'epoch-1',
  ) =>
    dispatch(
      saveFileContentRequested('ws', 'a.ts', '/repo/a.ts', text(content), {
        requestId,
        authority: requestAuthority,
      }),
    );
  return {
    task,
    transport,
    dispatch,
    load,
    edit,
    save,
    setAuthority: (value: string | null) => {
      authority = value;
    },
    setPublicationAuthority: (value: string | null) => {
      publicationAuthority = value;
    },
    entry: () => getFileContentEntry(state, 'ws', 'a.ts'),
    operation: (id = 'request-1') => getFileSaveOperation(state, id),
    state: () => state,
  };
}

describe('shared explicit file save owner', () => {
  it('sends exactly one explicit write and preserves a newer edit that reverted to the original', async () => {
    const h = harness();
    const reply = deferred<unknown>();
    h.transport.mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      return reply.promise;
    });
    h.load();
    h.edit('new');
    expect(h.transport).not.toHaveBeenCalled();
    h.save();
    h.save();
    h.save('duplicate');
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.transport).toHaveBeenCalledWith(
      'file.write',
      {
        workspaceId: 'ws',
        path: 'a.ts',
        content: 'new',
        idempotencyKey: expect.any(String),
      },
      { onDispatch: expect.any(Function) },
    );
    expect(h.operation()).toMatchObject({ status: 'running' });
    expect(h.operation('duplicate')).toMatchObject({ status: 'cancelled' });
    h.edit('old');
    reply.resolve({ ok: true });
    await flush();
    expect(h.entry()).toMatchObject({ originalContent: 'new', localContent: 'old', saving: false });
    expect(h.operation()).toMatchObject({ status: 'succeeded' });
    h.save();
    await flush();
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.stringify(h.state()))).toEqual(h.state());
  });

  it.each(['workspace', 'file', 'owner'] as const)(
    'settles running writes after %s cleanup without publishing into a reopened view',
    async (cleanup) => {
      const h = harness({ stablePublication: true });
      const reply = deferred<unknown>();
      h.transport.mockImplementation(async (_method, _params, options) => {
        options?.onDispatch?.();
        return reply.promise;
      });
      h.load();
      h.edit('new');
      h.save();
      if (cleanup === 'workspace') h.dispatch(workspaceUnmounted('ws'));
      else if (cleanup === 'file') h.dispatch(removeFileContentEntry('ws', 'a.ts'));
      else h.task.cancel();
      h.setAuthority('epoch-2');
      h.load('fresh read');
      reply.resolve({ ok: true });
      await flush();
      expect(h.operation()).toMatchObject({ status: 'succeeded' });
      expect(h.entry()?.originalContent).toBe('fresh read');
      expect(h.transport).toHaveBeenCalledTimes(1);
    },
  );

  it('declines a queued write after departure while preserving the shared Git barrier', async () => {
    const h = harness();
    const lease = reserveGitMutation('ws');
    try {
      h.load();
      h.edit('new');
      h.save();
      expect(h.operation()?.status).toBe('queued');
      h.dispatch(workspaceUnmounted('ws'));
      h.setAuthority('epoch-2');
      h.load();
      h.edit('fresh');
      await lease.release();
      await flush();
      expect(h.transport).not.toHaveBeenCalled();
      expect(h.operation()?.status).toBe('cancelled');
      expect(h.entry()?.localContent).toBe('fresh');
    } finally {
      await lease.release();
    }
  });

  it('rechecks authority at final dispatch after asynchronous route selection', async () => {
    const h = harness({ stablePublication: true });
    const route = deferred<void>();
    const wire = vi.fn();
    h.transport.mockImplementation(async (_method, _params, options) => {
      await route.promise;
      options?.onDispatch?.();
      wire();
      return { ok: true };
    });
    h.load();
    h.edit('new');
    h.save();
    h.setAuthority(null);
    route.resolve();
    await flush();
    expect(wire).not.toHaveBeenCalled();
    expect(h.operation()?.status).toBe('cancelled');
  });

  it('retains unsafe read observations through a failed retry and a later complete read', async () => {
    const h = harness();
    const lease = reserveGitMutation('ws');
    try {
      h.load();
      h.edit('new');
      h.save();
      h.dispatch(
        loadFileContentSucceeded(
          'ws',
          'alias',
          '/repo/a.ts',
          {
            kind: 'read-only-text',
            content: 'prefix',
            bytesRead: 6,
            totalBytes: 100,
          },
          true,
        ),
      );
      h.dispatch(loadFileContentRequested('ws', 'alias', '/repo/a.ts'));
      h.dispatch(loadFileContentFailed('ws', 'alias', '/repo/a.ts', 'read failed'));
      h.dispatch(removeFileContentEntry('ws', 'alias'));
      h.load();
      await lease.release();
      await flush();
      expect(h.transport).not.toHaveBeenCalled();
      expect(h.operation()?.status).toBe('failed');
    } finally {
      await lease.release();
    }
  });

  it('blocks truncated, binary, preview-only, and read-only content, including after a failed retry', async () => {
    const h = harness();
    const observations = [
      { content: text('partial'), truncated: true },
      { content: { kind: 'preview-only' as const, isBinary: true }, truncated: false },
      { content: { kind: 'preview-only' as const, isBinary: false }, truncated: false },
      {
        content: {
          kind: 'read-only-text' as const,
          content: 'prefix',
          bytesRead: 6,
          totalBytes: 100,
        },
        truncated: true,
      },
    ];
    for (const [index, observation] of observations.entries()) {
      h.dispatch(
        loadFileContentSucceeded(
          'ws',
          'a.ts',
          '/repo/a.ts',
          observation.content,
          observation.truncated,
        ),
      );
      h.save(`unsafe-${index}`, 'partial');
      expect(h.operation(`unsafe-${index}`)?.status).toBe('cancelled');
      h.dispatch(loadFileContentRequested('ws', 'a.ts', '/repo/a.ts'));
      h.dispatch(loadFileContentFailed('ws', 'a.ts', '/repo/a.ts', 'failed'));
      h.save(`retry-${index}`, 'partial');
      expect(h.operation(`retry-${index}`)?.status).toBe('cancelled');
    }
    await flush();
    expect(h.transport).not.toHaveBeenCalled();
  });

  it('retains unknown outcomes across disconnect and blocks retry even after a fresh read', async () => {
    const h = harness();
    const reply = deferred<unknown>();
    h.transport.mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      return reply.promise;
    });
    h.load();
    h.edit('new');
    h.save();
    h.dispatch(workspaceUnmounted('ws'));
    h.setAuthority('epoch-2');
    reply.reject(new Error('socket closed'));
    await flush();
    expect(h.operation()?.status).toBe('uncertain');
    h.load();
    h.edit('new');
    h.save('retry');
    await flush();
    expect(h.operation('retry')?.status).toBe('cancelled');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });

  it('permits a new explicit attempt after a confirmed daemon refusal without losing draft edits', async () => {
    const h = harness();
    h.transport.mockImplementationOnce(async (_method, _params, options) => {
      options?.onDispatch?.();
      throw new BackendError({ code: 'forbidden', message: 'permission denied', rpcCode: -32003 });
    });
    h.load();
    h.edit('new');
    h.save();
    await flush();
    expect(h.operation()?.status).toBe('failed');
    expect(h.entry()?.localContent).toBe('new');
    h.save('retry');
    await flush();
    expect(h.operation('retry')?.status).toBe('succeeded');
    expect(h.transport).toHaveBeenCalledTimes(2);
  });

  it('declines stale content, stale authority, and unguarded requests without changing the file cache', async () => {
    const h = harness();
    h.load();
    h.edit('new');
    h.save('stale-content', 'other');
    h.save('stale-authority', 'new', 'epoch-0');
    h.dispatch(saveFileContentRequested('ws', 'a.ts', '/repo/a.ts', text('new')));
    await flush();
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.entry()?.localContent).toBe('new');
  });
});

describe('explicit host publication authority and UTF-8 budget', () => {
  it('applies acknowledged bytes after a same-owner reconnect while preserving later edits', async () => {
    const h = harness({ stablePublication: true });
    const reply = deferred<unknown>();
    h.transport.mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      return reply.promise;
    });
    h.load();
    h.edit('new');
    h.save();
    h.edit('newer');
    h.setAuthority('epoch-2');
    reply.resolve({ ok: true });
    await flush();
    expect(h.entry()).toMatchObject({
      originalContent: 'new',
      localContent: 'newer',
      saving: false,
    });
    expect(h.operation()?.status).toBe('succeeded');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });

  it('settles but cannot publish into a different principal, backend or root', async () => {
    const h = harness({ stablePublication: true });
    const reply = deferred<unknown>();
    h.transport.mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      return reply.promise;
    });
    h.load();
    h.edit('new');
    h.save();
    h.setAuthority('epoch-2');
    h.setPublicationAuthority('principal-backend-root-2');
    reply.resolve({ ok: true });
    await flush();
    expect(h.entry()).toMatchObject({ originalContent: 'old', localContent: 'new' });
    expect(h.operation()?.status).toBe('succeeded');
  });

  it.each(['original', 'request'] as const)(
    'rejects a complete %s whose UTF-8 bytes exceed the host budget',
    async (target) => {
      const h = harness({ maxBytes: 3 });
      h.load(target === 'original' ? '😀' : 'old');
      const content = target === 'request' ? '😀' : 'x';
      h.edit(content);
      h.save('request-1', content);
      await flush();
      expect(h.transport).not.toHaveBeenCalled();
      expect(h.operation()?.status).toBe('cancelled');
    },
  );

  it('admits exactly the byte budget, including complete multibyte text', async () => {
    const h = harness({ maxBytes: 4 });
    h.load('old');
    h.edit('😀');
    h.save('request-1', '😀');
    await flush();
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.operation()?.status).toBe('succeeded');
    expect(h.entry()?.originalContent).toBe('😀');
  });

  it('rechecks complete original bytes at final dispatch after asynchronous host work', async () => {
    const h = harness({ maxBytes: 4 });
    const route = deferred<void>();
    const wire = vi.fn();
    h.transport.mockImplementation(async (_method, _params, options) => {
      await route.promise;
      options?.onDispatch?.();
      wire();
      return { ok: true };
    });
    h.load();
    h.edit('new');
    h.save();
    h.load('😀😀');
    route.resolve();
    await flush();
    expect(wire).not.toHaveBeenCalled();
    expect(h.operation()?.status).toBe('failed');
    expect(h.entry()?.originalContent).toBe('😀😀');
  });
});
