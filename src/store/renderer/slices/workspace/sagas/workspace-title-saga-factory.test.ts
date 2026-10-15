import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { StoreAction } from '@themislib/themis/types';
import type { Workspace } from '$shared/types';
import type { WorkspaceUpdateResult, WorkspacesClient } from '$lib/client/workspaces-client-types';
import {
  initialState,
  workspaceReducer,
  setWorkspaceEntity,
  replaceWorkspaceList,
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
  resetWorkspaceState,
  removeWorkspaceEntity,
  renameWorkspaceTitleRequested,
  workspaceTitleViewOpened,
  workspaceTitleViewReleased,
  workspaceTitleOperationSettled,
} from '../workspace-slice';
import {
  getWorkspaceTitleOperations,
  getWorkspaceTitleOperation,
  getWorkspaceTitleRevision,
  getWorkspaceTitleViewCurrent,
  getPendingWorkspaceTitleToken,
} from '../workspace-title-projections';
import type { WorkspaceTitleRequest } from '../workspace-types';
import {
  workspaceDeleted,
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { createWorkspaceTitleSaga } from './workspace-title-saga-factory';

const workspace = { id: 'ws-1', title: 'Original', branch: 'main' } as Workspace;
const tasks: Task[] = [];
afterEach(() => {
  tasks.splice(0).forEach((task) => task.cancel());
});
const getWorkspace = (state: { workspace: typeof initialState }, id: string) =>
  getItem(state.workspace.workspaces, id);

function harness(
  update: WorkspacesClient['update'],
  strict = true,
  observe?: (action: StoreAction<unknown>) => void,
) {
  let state = { workspace: workspaceReducer(initialState, setWorkspaceEntity(workspace)) };
  let authority = 'principal-1';
  const channel = stdChannel();
  const dispatch = (action: StoreAction<unknown>) => {
    state = { workspace: workspaceReducer(state.workspace, action) };
    observe?.(action);
    channel.put(action);
    return action;
  };
  dispatch(workspaceTitleViewOpened('view-1', workspace.id, authority));
  const task = runSaga(
    { channel, dispatch, getState: () => state },
    createWorkspaceTitleSaga({
      update,
      selectWorkspace: function* (id) {
        return yield* select(getWorkspace, id);
      },
      selectPendingToken: function* (id) {
        return yield* select(getPendingWorkspaceTitleToken, id);
      },
      ...(strict
        ? {
            admission: {
              selectOperations: function* (id: string) {
                return yield* select(getWorkspaceTitleOperations, id);
              },
              selectRevision: function* (id: string) {
                return yield* select(getWorkspaceTitleRevision, id);
              },
              readRevision: (id: string) => getWorkspaceTitleRevision(state, id),
              isCurrent: (request: WorkspaceTitleRequest) =>
                request.authority === authority && getWorkspaceTitleViewCurrent(state, request),
              canPublish: (request: WorkspaceTitleRequest) => request.authority === authority,
              dispatch,
            },
          }
        : {}),
    }),
  );
  tasks.push(task);
  const request = (overrides: Partial<WorkspaceTitleRequest> = {}) => {
    const action = renameWorkspaceTitleRequested({
      workspaceId: workspace.id,
      title: 'Renamed',
      previousTitle: 'Original',
      token: 1,
      ...(strict
        ? {
            requestId: 'request-1',
            authority: 'principal-1',
            viewId: 'view-1',
            expectedRevision: getWorkspaceTitleRevision(state, workspace.id),
          }
        : {}),
      ...overrides,
    });
    dispatch(action);
    return action.promise;
  };
  return {
    task,
    request,
    dispatch,
    get state() {
      return state;
    },
    retirePrincipal() {
      authority = 'principal-2';
    },
  };
}

function deferred() {
  let resolve!: (result: WorkspaceUpdateResult) => void;
  const promise = new Promise<WorkspaceUpdateResult>((done) => {
    resolve = done;
  });
  const update = vi.fn<WorkspacesClient['update']>((_request, options) => {
    options?.onDispatch();
    return promise;
  });
  return { resolve, update };
}
const confirmed = {
  success: true,
  titleOutcome: 'confirmed',
  workspace: { ...workspace, title: 'Renamed' },
} as const;

describe('shared workspace title owner', () => {
  it('sends one trimmed title-only request and changes only the canonical title', async () => {
    const update = vi.fn<WorkspacesClient['update']>(async (_request, options) => {
      options?.onDispatch();
      return confirmed;
    });
    const h = harness(update);
    await expect(h.request({ title: '  Renamed  ' })).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledExactlyOnceWith(
      { id: 'ws-1', title: 'Renamed' },
      { requireTitleReceipt: true, onDispatch: expect.any(Function) },
    );
    expect(getWorkspace(h.state, 'ws-1')).toMatchObject({ title: 'Renamed', branch: 'main' });
    expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('confirmed');
  });

  it.each(['', '  ', ' Original '])(
    'does not dispatch a blank or unchanged title %j',
    async (title) => {
      const update = vi.fn<WorkspacesClient['update']>();
      const h = harness(update);
      await expect(h.request({ title })).resolves.toEqual({ ok: true });
      expect(update).not.toHaveBeenCalled();
      expect(getWorkspaceTitleOperations(h.state, 'ws-1')).toEqual([]);
    },
  );

  it('rejects a captured old callback after same-context leave/reentry', async () => {
    const update = vi.fn<WorkspacesClient['update']>();
    const h = harness(update);
    h.dispatch(workspaceTitleViewReleased('view-1'));
    h.dispatch(workspaceTitleViewOpened('view-1', 'ws-1', 'principal-1'));
    h.dispatch(workspaceTitleViewOpened('view-2', 'ws-1', 'principal-1'));
    expect((await h.request()).ok).toBe(false);
    expect((await h.request({ title: 'Original' })).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['principal', 'view'] as const)(
    'checks the original %s after asynchronous transport preflight',
    async (retired) => {
      let preflight!: () => void;
      const ready = new Promise<void>((resolve) => {
        preflight = resolve;
      });
      const wire = vi.fn();
      const h = harness(async (_request, options) => {
        await ready;
        options?.onDispatch();
        wire();
        return confirmed;
      });
      const pending = h.request();
      if (retired === 'principal') h.retirePrincipal();
      else {
        h.dispatch(workspaceTitleViewReleased('view-1'));
        h.dispatch(workspaceTitleViewOpened('view-2', 'ws-1', 'principal-1'));
      }
      preflight();
      expect(await pending).toMatchObject({ ok: false, outcome: 'failed' });
      expect(wire).not.toHaveBeenCalled();
      expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('failed');
    },
  );

  it.each([
    ['unmount', workspaceUnmounted],
    ['deletion', workspaceDeleted],
    ['entity removal', removeWorkspaceEntity],
  ] as const)('retires only matching title views on canonical %s', async (_name, depart) => {
    const update = vi.fn<WorkspacesClient['update']>(async (_request, options) => {
      options?.onDispatch();
      return confirmed;
    });
    const h = harness(update);
    const expectedRevision = getWorkspaceTitleRevision(h.state, workspace.id);
    h.dispatch(workspaceTitleViewOpened('other-view', 'ws-2', 'principal-1'));
    const other = getItem(h.state.workspace.titleViews, 'other-view');
    h.dispatch(depart(workspace.id));
    expect(getItem(h.state.workspace.titleViews, 'view-1')?.released).toBe(true);
    expect(getItem(h.state.workspace.titleViews, 'other-view')).toBe(other);
    const departedState = h.state.workspace;
    h.dispatch(depart(workspace.id));
    expect(h.state.workspace).toBe(departedState);

    h.dispatch(workspaceMounted(workspace.id));
    h.dispatch(setWorkspaceEntity(workspace));
    h.dispatch(workspaceTitleViewOpened('view-1', workspace.id, 'principal-1'));
    expect((await h.request({ expectedRevision })).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();

    // Retirement also applies when the entity has already left the collection.
    h.dispatch(workspaceTitleViewOpened('absent-view', 'absent', 'principal-1'));
    h.dispatch(depart('absent'));
    expect(getItem(h.state.workspace.titleViews, 'absent-view')?.released).toBe(true);
  });

  it.each([
    ['unmount', workspaceUnmounted],
    ['deletion', workspaceDeleted],
    ['entity removal', removeWorkspaceEntity],
  ] as const)(
    'retains dispatched and unknown receipts through canonical %s',
    async (_name, depart) => {
      const d = deferred();
      const h = harness(d.update);
      const pending = h.request();
      const running = getWorkspaceTitleOperation(h.state, 'request-1');
      h.dispatch(depart(workspace.id));
      expect(getWorkspaceTitleOperation(h.state, 'request-1')).toBe(running);
      d.resolve({ success: false, titleOutcome: 'unknown' });
      await expect(pending).resolves.toMatchObject({ ok: false, outcome: 'unknown' });
      const unknown = getWorkspaceTitleOperation(h.state, 'request-1');
      h.dispatch(workspaceMounted(workspace.id));
      h.dispatch(setWorkspaceEntity(workspace));
      h.dispatch(workspaceTitleViewOpened('view-2', workspace.id, 'principal-1'));
      expect((await h.request({ requestId: 'request-2', viewId: 'view-2' })).ok).toBe(false);
      h.dispatch(depart(workspace.id));
      expect(getWorkspaceTitleOperation(h.state, 'request-1')).toBe(unknown);
      expect(d.update).toHaveBeenCalledOnce();
    },
  );

  it('rechecks authority after a synchronous dispatch observer retires it', async () => {
    const wire = vi.fn();
    const h = harness(
      async (_request, options) => {
        options?.onDispatch();
        wire();
        return confirmed;
      },
      true,
      (action) => {
        if (action.type === 'workspace/workspaceTitleOperationStarted') h.retirePrincipal();
      },
    );
    expect(await h.request()).toMatchObject({ ok: false, outcome: 'failed' });
    expect(wire).not.toHaveBeenCalled();
    expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('failed');
  });

  it('refuses a stale draft or newer title observation before transport dispatch', async () => {
    let preflight!: () => void;
    const ready = new Promise<void>((resolve) => {
      preflight = resolve;
    });
    const wire = vi.fn();
    const h = harness(async (_request, options) => {
      await ready;
      options?.onDispatch();
      wire();
      return confirmed;
    });
    const pending = h.request();
    h.dispatch(setWorkspaceEntity({ ...workspace, title: 'External' }));
    preflight();
    expect(await pending).toMatchObject({ ok: false, outcome: 'failed' });
    expect(wire).not.toHaveBeenCalled();
    expect(getWorkspace(h.state, 'ws-1')?.title).toBe('External');
    expect((await h.request({ requestId: 'request-2' })).ok).toBe(false);
    expect(getWorkspaceTitleOperation(h.state, 'request-2')?.status).toBe('failed');
    expect(wire).not.toHaveBeenCalled();
  });

  it('rejects an edit-start draft after the canonical title changes away and back', async () => {
    const update = vi.fn<WorkspacesClient['update']>(async (_request, options) => {
      options?.onDispatch();
      return confirmed;
    });
    const h = harness(update);
    const expectedRevision = getWorkspaceTitleRevision(h.state, workspace.id);
    h.dispatch(setWorkspaceEntity({ ...workspace, title: 'External' }));
    h.dispatch(setWorkspaceEntity(workspace));

    await expect(h.request({ expectedRevision })).resolves.toMatchObject({
      ok: false,
      outcome: 'failed',
    });
    expect(update).not.toHaveBeenCalled();
    expect(getWorkspace(h.state, workspace.id)?.title).toBe('Original');
    expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('failed');

    // A new edit captures the current observation and may be explicitly submitted.
    await expect(h.request({ requestId: 'request-2' })).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledOnce();
  });

  it.each([undefined, -1, NaN])(
    'rejects a guarded request without a valid edit-start revision (%s)',
    async (expectedRevision) => {
      const update = vi.fn<WorkspacesClient['update']>(async (_request, options) => {
        options?.onDispatch();
        return confirmed;
      });
      const h = harness(update);
      await expect(h.request({ expectedRevision })).resolves.toMatchObject({
        ok: false,
        outcome: 'failed',
      });
      expect(update).not.toHaveBeenCalled();
      expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('failed');
    },
  );

  it('does not admit duplicate requests or concurrent title writes', async () => {
    const d = deferred();
    const h = harness(d.update);
    const pending = h.request();
    expect((await h.request()).ok).toBe(false);
    expect((await h.request({ requestId: 'request-2', title: 'Another' })).ok).toBe(false);
    expect(d.update).toHaveBeenCalledOnce();
    d.resolve(confirmed);
    await pending;
    expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('confirmed');
  });

  it('retains an in-flight receipt through departure and publishes only its title', async () => {
    const d = deferred();
    const h = harness(d.update);
    const pending = h.request();
    expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('running');
    h.dispatch(workspaceTitleViewReleased('view-1'));
    h.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { branch: 'changed' })]));
    d.resolve(confirmed);
    await pending;
    expect(getWorkspace(h.state, 'ws-1')).toMatchObject({ title: 'Renamed', branch: 'changed' });
    expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('confirmed');
  });

  it.each(['snapshot', 'event'] as const)(
    'never overwrites a newer authoritative title from a %s with a late receipt',
    async (kind) => {
      const d = deferred();
      const h = harness(d.update);
      const pending = h.request();
      if (kind === 'snapshot')
        h.dispatch(replaceWorkspaceList([{ ...workspace, title: 'External' }]));
      else
        h.dispatch(
          bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { title: 'External' })]),
        );
      d.resolve(confirmed);
      await pending;
      expect(getWorkspace(h.state, 'ws-1')?.title).toBe('External');
      expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('confirmed');
    },
  );

  it('does not mistake a newer return to the original title for the original revision', async () => {
    const d = deferred();
    const h = harness(d.update);
    const pending = h.request();
    h.dispatch(setWorkspaceEntity({ ...workspace, title: 'External' }));
    h.dispatch(setWorkspaceEntity(workspace));
    d.resolve(confirmed);
    await pending;
    expect(getWorkspace(h.state, 'ws-1')?.title).toBe('Original');
  });

  it('retains uncertain transport outcomes through reconnect and refuses replay', async () => {
    const d = deferred();
    const h = harness(d.update);
    const pending = h.request();
    h.retirePrincipal();
    h.dispatch(resetWorkspaceState());
    h.dispatch(setWorkspaceEntity(workspace));
    d.resolve({ success: false, titleOutcome: 'unknown' });
    expect(await pending).toMatchObject({ ok: false, outcome: 'unknown' });
    h.dispatch(workspaceTitleViewOpened('view-2', 'ws-1', 'principal-2'));
    expect(
      (await h.request({ requestId: 'request-2', authority: 'principal-2', viewId: 'view-2' })).ok,
    ).toBe(false);
    expect(d.update).toHaveBeenCalledOnce();
    expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('unknown');
    expect(getWorkspace(h.state, 'ws-1')?.title).toBe('Original');
  });

  it('permits an explicit retry after a definite refusal, keeping each correlation', async () => {
    const update = vi
      .fn<WorkspacesClient['update']>()
      .mockImplementationOnce(async (_request, options) => {
        options?.onDispatch();
        return { success: false, titleOutcome: 'failed', error: 'refused' };
      })
      .mockImplementationOnce(async (_request, options) => {
        options?.onDispatch();
        return confirmed;
      });
    const h = harness(update);
    expect(await h.request()).toMatchObject({ ok: false, outcome: 'failed' });
    expect(await h.request({ requestId: 'request-2', token: 2 })).toEqual({ ok: true });
    expect(getWorkspaceTitleOperations(h.state, 'ws-1').map((op) => op.status)).toEqual([
      'failed',
      'confirmed',
    ]);
    const before = h.state.workspace;
    h.dispatch(workspaceTitleOperationSettled('missing', 'confirmed', undefined, true));
    h.dispatch(workspaceTitleOperationSettled('request-1', 'confirmed', undefined, true));
    expect(h.state.workspace).toBe(before);
  });

  it('retains transport settlement after cancellation but never publishes across principal replacement', async () => {
    const d = deferred();
    const h = harness(d.update);
    const pending = h.request();
    h.retirePrincipal();
    h.task.cancel();
    await expect(pending).rejects.toThrow();
    expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('unknown');
    d.resolve(confirmed);
    await vi.waitFor(() =>
      expect(getWorkspaceTitleOperation(h.state, 'request-1')?.status).toBe('confirmed'),
    );
    expect(getWorkspace(h.state, 'ws-1')?.title).toBe('Original');
  });

  it('legacy binding preserves optimistic tokens and failure rollback', async () => {
    const d = deferred();
    const h = harness(d.update, false);
    const pending = h.request();
    expect(getWorkspace(h.state, 'ws-1')?.title).toBe('Renamed');
    h.dispatch(replaceWorkspaceList([workspace]));
    expect(getWorkspace(h.state, 'ws-1')?.title).toBe('Renamed');
    d.resolve({ success: false, error: 'refused' });
    expect(await pending).toEqual({ ok: false, error: 'refused' });
    expect(getWorkspace(h.state, 'ws-1')?.title).toBe('Original');
    expect(h.state.workspace.pendingTitleMutations).toEqual({});
  });
});
