import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select, type SagaGenerator } from 'typed-redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteCreateOptions } from '../../../../../lib/client/app-client';
import { createNoteCreate } from '../../../../../lib/client/live/backend-note-create';
import { normalizeNote } from '../../../../../lib/client/live/note-normalization';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import type { ExplicitNoteCreatorIdentity } from '../workspace-notes-types';
import * as actions from '../workspace-notes-slice';
import * as projections from '../workspace-notes-projections';
import { createNotesWriteSaga } from './notes-write-saga-factory';

const identity: ExplicitNoteCreatorIdentity = {
  workspaceId: 'ws',
  viewId: 'view',
  authority: 'principal@backend',
  context: 'connection-1',
};
const rawNote = {
  id: 'ours',
  workspaceId: 'ws',
  title: 'Fresh',
  content: '',
  rev: 0,
  contentType: 'markdown',
  tags: [],
  isPinned: false,
  isArchived: false,
  isDefault: false,
  visibility: 'workspace',
  metadata: {},
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
};
const receipt = {
  note: rawNote,
  convertedCount: 0,
  createdTaskNoteIds: [],
  createdTasks: [],
  warnings: [],
};
const tasks: Task[] = [];
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness() {
  const channel = stdChannel();
  let workspaceNotes = actions.workspaceNotesReducer(
    undefined,
    actions.loadWorkspaceNotesSucceeded(['ws'], { ws: [] }),
  );
  let currentAuthority = identity.authority;
  let currentContext = identity.context;
  let ready = true;
  let predispatch: Promise<unknown> | undefined;
  let skipDispatch = false;
  let observe: ((action: Parameters<typeof actions.workspaceNotesReducer>[1]) => void) | undefined;
  const getState = () => ({ workspaceNotes });
  const dispatch = (action: Parameters<typeof actions.workspaceNotesReducer>[1]) => {
    workspaceNotes = actions.workspaceNotesReducer(workspaceNotes, action);
    observe?.(action);
    channel.put(action);
    return action;
  };
  const wire = vi.fn(async (_method: string, _params?: unknown): Promise<unknown> => receipt);
  const backendRequest = vi.fn(
    async <T>(
      method: string,
      params?: unknown,
      options?: Partial<Pick<NoteCreateOptions, 'onDispatch'>>,
    ): Promise<T> => {
      if (predispatch) await predispatch;
      if (!skipDispatch) options?.onDispatch?.();
      return (await wire(method, params)) as T;
    },
  );
  const selector = <A extends unknown[], R>(
    project: (state: ReturnType<typeof getState>, ...args: A) => R,
  ) => ({
    *effect(...args: A): SagaGenerator<R> {
      return yield* select(project, ...args);
    },
  });
  const canPublish = (value: ExplicitNoteCreatorIdentity) =>
    ready && value.authority === currentAuthority && value.context === currentContext;
  const task = runSaga(
    { channel, dispatch, getState },
    createNotesWriteSaga({
      notes: { setContent: vi.fn() },
      selectNoteById: selector(projections.getNoteById),
      creation: {
        notes: { create: createNoteCreate({ backendRequest }) },
        selectCreator: selector(projections.getExplicitNoteCreator),
        selectOperations: selector(projections.getExplicitNoteCreateOperations),
        isCurrent: (value) =>
          canPublish(value) && projections.getExplicitNoteCreatorCurrent(getState(), value),
        canPublish,
        dispatch,
      },
    }),
  );
  tasks.push(task);
  const open = (value = identity) => dispatch(actions.explicitNoteCreatorOpened(value));
  const create = (
    requestId = 'op',
    value = identity,
    data = { title: 'Fresh', content: '', tags: [] as string[] },
  ) => {
    const request = actions.createNotePersistRequested(value.workspaceId, data, {
      ...value,
      requestId,
    });
    dispatch(request);
    return request.promise;
  };
  return {
    task,
    open,
    create,
    wire,
    backendRequest,
    getState,
    dispatch,
    ops: (authority?: string) =>
      projections.getExplicitNoteCreateOperations(getState(), 'ws', authority),
    setAuthority: (value: string) => {
      currentAuthority = value;
    },
    setContext: (value: string) => {
      currentContext = value;
    },
    setReady: (value: boolean) => {
      ready = value;
    },
    waitBeforeDispatch: (promise: Promise<unknown>) => {
      predispatch = promise;
    },
    bypassDispatch: () => {
      skipDispatch = true;
    },
    observe: (fn: typeof observe) => {
      observe = fn;
    },
  };
}
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

describe('explicit note creation owner', () => {
  it.each(['ours', 'unrelated'])(
    'honors an intervening deletion of %s before the creation receipt',
    async (deletedId) => {
      const h = harness();
      h.open();
      const pending = deferred<unknown>();
      h.wire.mockReturnValueOnce(pending.promise);
      const result = h.create();
      h.dispatch(actions.applyNoteCreated('ws', normalizeNote(rawNote, 'ws')));
      h.dispatch(actions.applyNoteDeleted('ws', deletedId));
      pending.resolve(receipt);
      await expect(result).resolves.toBe(deletedId === 'ours' ? undefined : 'ours');
      expect(h.ops()).toMatchObject([{ status: 'confirmed', noteId: 'ours' }]);
      expect(projections.getNoteById(h.getState(), 'ws', 'ours')?.id).toBe(
        deletedId === 'ours' ? undefined : 'ours',
      );
      expect(h.wire).toHaveBeenCalledOnce();
    },
  );

  it('sends one exact request and opens only the returned note despite a concurrent sibling', async () => {
    const h = harness();
    h.open();
    const pending = deferred<unknown>();
    h.wire.mockReturnValueOnce(pending.promise);
    const result = h.create();
    h.dispatch(
      actions.applyNoteUpdated('ws', 'sibling', normalizeNote({ ...rawNote, id: 'sibling' }, 'ws')),
    );
    h.dispatch(
      actions.applyNoteUpdated(
        'ws',
        'ours',
        normalizeNote({ ...rawNote, rev: 3, content: 'subscription' }, 'ws'),
      ),
    );
    pending.resolve(receipt);
    await expect(result).resolves.toBe('ours');
    expect(h.wire.mock.calls).toEqual([
      [
        'note.create',
        { workspaceId: 'ws', title: 'Fresh', content: '', tags: [], idempotencyKey: 'op' },
      ],
    ]);
    expect(projections.getNoteById(h.getState(), 'ws', 'ours')).toMatchObject({
      rev: 3,
      content: 'subscription',
    });
    expect(h.ops()).toMatchObject([
      { requestId: 'op', status: 'confirmed', noteId: 'ours', echoedRev: 0 },
    ]);
    await expect(h.create()).resolves.toBeUndefined();
    expect(h.wire).toHaveBeenCalledOnce();
  });

  it('rejects missing/unregistered/retired/foreign views and unsupported creation data', async () => {
    const h = harness();
    await expect(h.create()).resolves.toBeUndefined();
    h.open();
    await h.create('foreign', { ...identity, authority: 'other' });
    await h.create('workspace', { ...identity, workspaceId: 'other' });
    await h.create('context', { ...identity, context: 'other' });
    await h.create('blank', identity, { title: ' ', content: '', tags: [] });
    await h.create('task', identity, { title: 'Fresh', content: '@@@task\nTask\n@@@', tags: [] });
    await h.create('tagged', identity, { title: 'Fresh', content: '', tags: ['task'] });
    h.dispatch(actions.explicitNoteCreatorReleased('view'));
    h.open();
    await h.create('retired');
    expect(h.wire).not.toHaveBeenCalled();
    expect(h.ops()).toEqual([]);
    expect(projections.getExplicitNoteCreator(h.getState(), 'view')).toBeUndefined();
  });

  it.each(['context', 'authority', 'offline', 'release', 'root'] as const)(
    'fences %s retirement before final transport dispatch',
    async (reason) => {
      const h = harness();
      h.open();
      const pending = deferred<void>();
      h.waitBeforeDispatch(pending.promise);
      const result = h.create();
      if (reason === 'context') h.setContext('connection-2');
      if (reason === 'authority') h.setAuthority('other');
      if (reason === 'offline') h.setReady(false);
      if (reason === 'release') h.dispatch(actions.explicitNoteCreatorReleased('view'));
      if (reason === 'root') h.task.cancel();
      const outcome = result.catch(() => undefined);
      pending.resolve();
      await outcome;
      await settle();
      expect(h.wire).not.toHaveBeenCalled();
      expect(h.ops()).toMatchObject([{ status: 'failed' }]);
    },
  );

  it('rechecks after starting dispatch observers retire the view', async () => {
    const h = harness();
    h.open();
    h.observe((action) => {
      if (action.type === actions.explicitNoteCreateStarted.type)
        h.dispatch(actions.explicitNoteCreatorReleased('view'));
    });
    await h.create();
    expect(h.wire).not.toHaveBeenCalled();
    expect(h.ops()).toMatchObject([{ status: 'failed' }]);
  });

  it.each([
    actions.explicitNoteCreatorReleased('view'),
    actions.explicitNoteCreatorsRetired(),
    workspaceUnmounted('ws'),
    workspaceDeleted('ws'),
    actions.clearWorkspaceNotesForWorkspaces(['ws']),
  ])(
    'retains late receipts after departure without recreating notes or navigating',
    async (departure) => {
      const h = harness();
      h.open();
      const pending = deferred<unknown>();
      h.wire.mockReturnValueOnce(pending.promise);
      const result = h.create();
      h.dispatch(departure);
      await expect(result).resolves.toBeUndefined();
      expect(h.ops()).toMatchObject([{ status: 'unknown' }]);
      pending.resolve(receipt);
      await settle();
      expect(h.ops()).toMatchObject([{ status: 'confirmed', noteId: 'ours' }]);
      expect(projections.getNoteById(h.getState(), 'ws', 'ours')).toBeUndefined();
      h.open();
      await h.create('stale');
      expect(h.wire).toHaveBeenCalledOnce();
    },
  );

  it('retains a late receipt across root cancellation but settles the original request', async () => {
    const h = harness();
    h.open();
    const pending = deferred<unknown>();
    h.wire.mockReturnValueOnce(pending.promise);
    const result = h.create();
    h.task.cancel();
    await expect(result).resolves.toBeUndefined();
    expect(projections.getExplicitNoteCreator(h.getState(), 'view')).toBeUndefined();
    expect(h.getState().workspaceNotes.revokedCreatorViews.view).toBe(true);
    expect(h.ops()).toMatchObject([{ status: 'unknown' }]);
    pending.resolve(receipt);
    await settle();
    expect(h.ops()).toMatchObject([{ status: 'confirmed', noteId: 'ours' }]);
    expect(projections.getNoteById(h.getState(), 'ws', 'ours')).toBeUndefined();
  });

  it('blocks concurrent and unknown creates across views and authorities without exposing foreign receipts', async () => {
    const h = harness();
    h.open();
    const pending = deferred<unknown>();
    h.wire.mockReturnValueOnce(pending.promise);
    const result = h.create();
    await h.create('double');
    pending.reject(Object.assign(new Error('idempotency persistence failed'), { rpcCode: -32603 }));
    await result;
    h.dispatch(actions.explicitNoteCreatorReleased('view'));
    h.setAuthority('other');
    const other = { ...identity, viewId: 'other-view', authority: 'other' };
    h.open(other);
    await h.create('other-op', other);
    expect(h.ops()).toMatchObject([{ status: 'unknown' }]);
    expect(h.ops('other')).toEqual([]);
    expect(h.wire).toHaveBeenCalledOnce();
  });

  it('allows a new deliberate request after a known refusal, but never replays the refused key', async () => {
    const h = harness();
    h.open();
    h.wire.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { rpcCode: -32003 }));
    await h.create();
    await h.create();
    expect(h.ops()).toMatchObject([{ status: 'failed' }]);
    await expect(h.create('new-request')).resolves.toBe('ours');
    expect(h.wire).toHaveBeenCalledTimes(2);
  });

  it('retains authoritative receipts without publishing after an authority changes', async () => {
    const h = harness();
    h.open();
    const pending = deferred<unknown>();
    h.wire.mockReturnValueOnce(pending.promise);
    const result = h.create();
    h.setAuthority('other');
    pending.resolve(receipt);
    await expect(result).resolves.toBeUndefined();
    expect(h.ops(identity.authority)).toMatchObject([{ status: 'confirmed', noteId: 'ours' }]);
    expect(h.ops('other')).toEqual([]);
    expect(projections.getNoteById(h.getState(), 'ws', 'ours')).toBeUndefined();
  });

  it('malformed receipt keeps creation unresolved and cannot be retried', async () => {
    const h = harness();
    h.open();
    h.wire.mockResolvedValueOnce({ note: { ...rawNote, workspaceId: 'wrong' } });
    await h.create();
    await h.create('again');
    expect(h.ops()).toMatchObject([{ status: 'unknown' }]);
    expect(h.wire).toHaveBeenCalledOnce();
  });

  it('does not downgrade a client-reported unknown outcome when dispatch evidence is absent', async () => {
    const h = harness();
    h.open();
    h.bypassDispatch();
    await h.create();
    await h.create('again');
    expect(h.ops()).toMatchObject([{ status: 'unknown' }]);
    expect(h.wire).toHaveBeenCalledOnce();
  });
});
