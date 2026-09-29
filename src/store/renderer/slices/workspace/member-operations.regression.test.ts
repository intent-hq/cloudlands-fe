import { terminalCreationSaga } from '../terminals/sagas/terminal-creation-saga';
import { createPanelTerminalRequested } from '../terminals/terminals-slice';
import { scriptsOperationSaga } from '../scripts/sagas/scripts-operation-saga';
import { startScriptRequested } from '../scripts/scripts-slice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { principalReceived, hostMembershipChanged } from '../principal/principal-slice';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import { setLabsMultiplayerEnabled } from '../user-preferences/user-preferences-slice';
import {
  replaceWorkspaceList,
  setWorkspaceEntity,
  removeWorkspaceEntity,
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
  setWorkspaceHasLoaded,
  markWorkspacePendingDeletion,
  clearWorkspacePendingDeletion,
} from './workspace-slice';
import { captureDeletionExpiry } from './utils/workspace-deletion';
import {
  selectCanManageWorkspace,
  selectWorkspaceManagementDenied,
  selectHidesAgentLifecycleActions,
  selectWorkspaceActionContext,
} from './workspace-selectors';
import {
  requestDeleteWorkspace,
  openBulkDeleteConfirm,
  confirmBulkDelete,
  bulkOperationStarted,
  bulkOperationFinished,
} from '../workspace-operations/workspace-operations-slice';
import { workspaceOperationsSaga } from '../workspace-operations/sagas/workspace-operations-saga';
import {
  backendReconnected,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import { workspaceClient } from './utils/workspace.client';
import type { Workspace } from '$shared/types';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
const mock = vi.hoisted(() => ({
  recentViews: vi.fn(async () => ({})),
  delete: vi.fn(),
  cancelDelete: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  update: vi.fn(),
  terminal: vi.fn(),
  script: vi.fn(),
  notify: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('$features/scripts/scripts.client', () => ({ scriptsClient: { start: mock.script } }));
vi.mock('$lib/client', () => ({
  appClient: { workspaces: mock, terminals: { create: mock.terminal } },
}));
vi.mock('$features/workspace/navigate-away-if-viewing', () => ({ navigateAwayIfViewing: vi.fn() }));
vi.mock('$lib/utils/delete-warning-utils', () => ({
  getActiveWorkNames: vi.fn(async () => ({
    agentNames: [],
    hookNames: [],
    openPrs: [],
    localChanges: null,
    guests: { collaboratorCount: 0, openInviteCount: 0 },
  })),
}));
vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: mock.notify,
}));
const row = {
  id: 'member-workspace',
  title: 'Original',
  status: 'active',
  myRole: 'collaborator',
  canManage: true,
} as Workspace;
let dispose: () => void, task: Task | undefined;
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function admit(role: 'owner' | 'member' | 'guest', revision = 1) {
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      {
        context: p.context!,
        invalidation: p.invalidation,
        presentationVersion: p.presentationVersion,
      },
      {
        principal: {
          id: 'principal',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: role === 'owner',
          hostRole: role,
          hostMembershipRevision: revision,
        },
        capabilities: {
          hostMembership: true,
          personalPairing: false,
          authenticatedDevices: false,
          collaborationIdentity: false,
        },
      },
    ),
  );
}
function loaded() {
  // The third argument is the request's captured context on the successor. The
  // unchanged baseline ignores it, exposing its backend-only stamp.
  store.dispatch(
    Reflect.apply(setWorkspaceHasLoaded, null, [
      true,
      'local',
      selectPrincipalActionContext.select(store.state),
    ]),
  );
}
function start() {
  const channel = stdChannel();
  const dispatch = (a: Parameters<typeof store.dispatch>[0]) => {
    store.dispatch(a);
    channel.put(a);
  };
  task = runSaga({ channel, dispatch, getState: () => store.state }, workspaceOperationsSaga);
  dispatch(requestDeleteWorkspace(row.id));
  return dispatch;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.delete.mockReset();
  mock.cancelDelete.mockReset();
  vi.useFakeTimers();
  dispose = store.init();
  admitLegacyPrincipal();
  store.dispatch(setLabsMultiplayerEnabled(true));
  admit('member');
  store.dispatch(setWorkspaceEntity(row));
  loaded();
  mock.delete.mockResolvedValue({ success: true, scheduled: true, deleteAt: '2026-09-29' });
  mock.notify.warning.mockImplementation(
    () => `owned-toast-${mock.notify.warning.mock.calls.length}`,
  );
  mock.cancelDelete.mockResolvedValue({ success: true, cancelled: true });
  mock.update.mockImplementation(async (r) => ({ success: true, workspace: { ...row, ...r } }));
});
afterEach(async () => {
  task?.cancel();
  task = undefined;
  await settle();
  dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('real store, operation saga and client authority composition', () => {
  it.each(['owner', 'member', 'guest'] as const)(
    'virtual root keeps its explicit %s scope',
    (role) => {
      admit(role);
      expect(selectWorkspaceActionContext.select(store.state, ROOT_WORKSPACE_ID) !== null).toBe(
        role === 'owner',
      );
    },
  );
  it('does not infer legacy owner authority from a missing workspace row', async () => {
    admitLegacyPrincipal();
    store.dispatch(removeWorkspaceEntity(row.id));
    expect(selectWorkspaceActionContext.select(store.state, row.id)).toBeNull();
    expect((await workspaceClient.delete(row.id)).ok).toBe(false);
    expect((await workspaceClient.cancelDelete(row.id)).ok).toBe(false);
    expect(mock.delete).not.toHaveBeenCalled();
    expect(mock.cancelDelete).not.toHaveBeenCalled();
  });
  it.each(['owner', 'member'] as const)(
    'sends one %s delete before grace and supports Undo',
    async (role) => {
      admit(role);
      loaded();
      start();
      await settle();
      expect(mock.delete).toHaveBeenCalledExactlyOnceWith(row.id, { undoDelayMs: 15000 });
      expect(mock.notify.warning).toHaveBeenCalledTimes(1);
      mock.notify.warning.mock.calls[0][1].action.onClick();
      await settle();
      expect(mock.cancelDelete).toHaveBeenCalledExactlyOnceWith(row.id);
      expect(getItem(store.state.workspace.workspaces, row.id)?.title).toBe('Original');
    },
  );
  it.each(['readmission', 'authoritative removal'] as const)(
    'never restores an obsolete successful delete after %s',
    async (transition) => {
      // Legacy owner control reaches the transport on the unchanged implementation.
      admitLegacyPrincipal();
      store.dispatch(setWorkspaceEntity({ ...row, myRole: 'owner' }));
      let resolve!: (v: unknown) => void;
      mock.delete.mockReturnValue(new Promise((r) => (resolve = r)));
      const dispatch = start();
      await settle();
      expect(mock.delete).toHaveBeenCalledTimes(1);
      if (transition === 'readmission') dispatch(backendReconnected());
      else dispatch(workspaceDeleted(row.id, []));
      resolve({ success: true });
      await settle();
      expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
      expect(mock.notify.error).not.toHaveBeenCalled();
      expect(mock.notify.warning).not.toHaveBeenCalled();
    },
  );
  it('guest ownership is not script, terminal or agent lifecycle authority', () => {
    admit('guest');
    store.dispatch(setWorkspaceEntity({ ...row, myRole: 'owner' }));
    loaded();
    expect(selectHidesAgentLifecycleActions.select(store.state, row.id)).toBe(true);
    expect(selectWorkspaceActionContext.select(store.state, row.id)).toBeNull();
  });
  it('ordinary scoped guest can update title through the actual client', async () => {
    admit('guest');
    store.dispatch(setWorkspaceEntity({ ...row, canManage: false }));
    loaded();
    const r = await workspaceClient.update({ id: row.id, title: 'Guest title' });
    expect(r.ok).toBe(true);
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ id: row.id, title: 'Guest title' });
  });
  it('guest owner can use the separately authorized workspace.update archive delegation', async () => {
    admit('guest');
    store.dispatch(setWorkspaceEntity({ ...row, myRole: 'owner' }));
    loaded();
    expect((await workspaceClient.update({ id: row.id, status: 'archived' } as never)).ok).toBe(
      true,
    );
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ id: row.id, status: 'archived' });
  });
  it('readmission withholds old capabilities and old denial until its projection arrives', () => {
    store.dispatch(
      hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }),
    );
    admit('guest', 2);
    expect(selectCanManageWorkspace.select(store.state, row.id)).toBe(false);
    expect(selectWorkspaceManagementDenied.select(store.state, row.id)).toBe(false);
  });
});

describe('method-specific execution consumers', () => {
  it.each(['owner', 'member', 'guest'] as const)(
    '%s script and terminal methods use execution eligibility',
    async (role) => {
      admit(role);
      store.dispatch(setWorkspaceEntity({ ...row, myRole: 'owner' }));
      loaded();
      mock.terminal.mockResolvedValue({ success: false, error: 'test-stop' });
      mock.script.mockResolvedValue({ success: false, error: 'test-stop' });
      for (const [saga, action, spy] of [
        [terminalCreationSaga, createPanelTerminalRequested(row.id), mock.terminal],
        [scriptsOperationSaga, startScriptRequested(row.id, 's'), mock.script],
      ] as const) {
        const channel = stdChannel();
        const t = runSaga(
          { channel, dispatch: (a) => store.dispatch(a), getState: () => store.state },
          saga,
        );
        channel.put(action);
        await settle();
        expect(spy).toHaveBeenCalledTimes(role === 'guest' ? 0 : 1);
        t.cancel();
        await t.toPromise();
      }
    },
  );
  it.each(['title', 'tags', 'statusMessage', 'statusImageAssetId'])(
    'permits scoped guest card field %s and rejects lifecycle fields',
    async (field) => {
      admit('guest');
      store.dispatch(setWorkspaceEntity({ ...row, canManage: false }));
      loaded();
      expect(
        (
          await workspaceClient.update({
            id: row.id,
            [field]: field === 'tags' ? ['one'] : 'value',
          })
        ).ok,
      ).toBe(true);
      expect((await workspaceClient.update({ id: row.id, status: 'archived' } as never)).ok).toBe(
        false,
      );
      expect(mock.update).toHaveBeenCalledTimes(1);
    },
  );
  it('same-admission failure restores the row', async () => {
    mock.delete.mockResolvedValue({ success: false, error: 'ordinary failure' });
    start();
    await settle();
    expect(getItem(store.state.workspace.workspaces, row.id)?.title).toBe('Original');
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
    expect(mock.notify.error).toHaveBeenCalledTimes(1);
  });
});

describe('delete ownership across store and admission transitions', () => {
  it.each(['unknown', 'revoked', 'guest'] as const)(
    'does not delete under %s authority',
    async (kind) => {
      if (kind === 'unknown') store.dispatch(backendReconnected());
      else if (kind === 'revoked') {
        store.dispatch(setWorkspaceEntity({ ...row, canManage: false }));
      } else {
        admit('guest');
        loaded();
      }
      start();
      await settle();
      expect(mock.delete).not.toHaveBeenCalled();
      expect(getItem(store.state.workspace.workspaces, row.id)).toBeDefined();
    },
  );
  it.each(['delete', 'undo'] as const)(
    'held %s cannot write into a replacement store',
    async (phase) => {
      let resolve!: (v: unknown) => void;
      (phase === 'delete' ? mock.delete : mock.cancelDelete).mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      start();
      await settle();
      if (phase === 'undo') {
        mock.notify.warning.mock.calls[0][1].action.onClick();
        await settle();
      }
      expect(phase === 'delete' ? mock.delete : mock.cancelDelete).toHaveBeenCalledTimes(1);
      dispose();
      dispose = store.init();
      admitLegacyPrincipal();
      store.dispatch(setWorkspaceEntity({ ...row, title: 'New store', myRole: 'owner' }));
      store.dispatch(markWorkspacePendingDeletion(row.id, 'new-operation'));
      resolve({ success: true, cancelled: true });
      await settle();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(getItem(store.state.workspace.workspaces, row.id)?.title).toBe('New store');
      expect(store.state.workspace.deletionTokens[row.id]).toBe('new-operation');
      expect(mock.notify.error).not.toHaveBeenCalled();
      expect(mock.notify.warning).toHaveBeenCalledTimes(phase === 'undo' ? 1 : 0);
      expect(mock.notify.dismiss.mock.calls).toEqual(phase === 'undo' ? [['owned-toast-1']] : []);
    },
  );
  it.each(['demotion', 'unshare', 'reconnect'] as const)(
    'held Undo settles silently after %s',
    async (kind) => {
      let resolve!: (v: unknown) => void;
      mock.cancelDelete.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const dispatch = start();
      await settle();
      mock.notify.warning.mock.calls[0][1].action.onClick();
      await settle();
      expect(mock.cancelDelete).toHaveBeenCalledTimes(1);
      if (kind === 'demotion') {
        dispatch(
          hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }),
        );
        admit('guest', 2);
      } else if (kind === 'unshare') dispatch(workspaceDeleted(row.id, []));
      else dispatch(backendReconnected());
      resolve({ success: true, cancelled: true });
      await settle();
      expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
      expect(mock.notify.error).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
    },
  );
  it('captured expiry cannot clear a newer deletion of the same ID', () => {
    store.dispatch(markWorkspacePendingDeletion(row.id, 'old'));
    const expire = captureDeletionExpiry(row.id);
    store.dispatch(clearWorkspacePendingDeletion(row.id, 'old'));
    store.dispatch(markWorkspacePendingDeletion(row.id, 'new'));
    expire();
    expect(store.state.workspace.deletionTokens[row.id]).toBe('new');
  });
  it('ordinary success retains the original undo and tombstone grace then expires', async () => {
    start();
    await settle();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.cancelDelete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
  });
});

it('current capability revocation while optimistically absent prevents rollback', async () => {
  let resolve!: (x: unknown) => void;
  mock.delete.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const dispatch = start();
  await settle();
  dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(row.id, { canManage: false })]));
  resolve({ success: false, error: 'late failure' });
  await settle();
  expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
  expect(mock.notify.error).not.toHaveBeenCalled();
});

describe('residual bulk intent ownership through real saga and client', () => {
  const second = { ...row, id: 'second-workspace', title: 'Second' } as Workspace;
  async function startBulk() {
    store.dispatch(setWorkspaceEntity(second));
    const channel = stdChannel();
    const dispatch = (a: Parameters<typeof store.dispatch>[0]) => {
      store.dispatch(a);
      channel.put(a);
    };
    task = runSaga({ channel, dispatch, getState: () => store.state }, workspaceOperationsSaga);
    dispatch(openBulkDeleteConfirm({ workspaceIds: [row.id, second.id], groupLabel: 'Both' }));
    await settle();
    expect(store.state.workspaceOperations.bulkPreflightReady).toBe(true);
    dispatch(confirmBulkDelete());
    await settle();
    return dispatch;
  }
  it.each(['before', 'after'] as const)(
    'keeps the original bulk grace when authoritative deletion arrives %s the reply',
    async (timing) => {
      let resolve!: (value: unknown) => void;
      mock.delete.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const dispatch = await startBulk();
      const token = store.state.workspace.deletionTokens[row.id];
      expect(mock.delete).toHaveBeenCalledExactlyOnceWith(row.id, undefined);
      if (timing === 'before') dispatch(workspaceDeleted(row.id, []));
      resolve({ success: true });
      await settle();
      expect(mock.delete.mock.calls).toEqual([
        [row.id, undefined],
        [second.id, undefined],
      ]);
      await vi.advanceTimersByTimeAsync(5000);
      if (timing === 'after') dispatch(workspaceDeleted(row.id, []));
      dispatch(replaceWorkspaceList([row, second]));
      dispatch(setWorkspaceEntity(row, { detailRead: true }));
      expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
      expect(store.state.workspace.deletionTokens[row.id]).toBe(token);
      expect(mock.notify.success).toHaveBeenCalledTimes(1);
      expect(mock.notify.error).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(54_999);
      expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
    },
  );
  it('retains a confirmed removal without fabricating a successful RPC result', async () => {
    let resolve!: (value: unknown) => void;
    mock.delete.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const dispatch = await startBulk();
    const token = store.state.workspace.deletionTokens[row.id];
    dispatch(workspaceDeleted(row.id, []));
    resolve({ success: false, error: 'actual first RPC failure' });
    await settle();
    expect(mock.delete.mock.calls).toEqual([
      [row.id, undefined],
      [second.id, undefined],
    ]);
    expect(mock.notify.error).toHaveBeenCalledTimes(1);
    expect(mock.notify.success).toHaveBeenCalledTimes(1);
    expect(store.state.workspace.deletionTokens[row.id]).toBe(token);
    dispatch(replaceWorkspaceList([row, second]));
    expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
  });
  it('retains the confirmed terminal tombstone against a late projection', async () => {
    let resolve!: (value: unknown) => void;
    mock.delete.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const dispatch = await startBulk();
    const token = store.state.workspace.deletionTokens[row.id];
    dispatch(workspaceDeleted(row.id, []));
    resolve({ success: true });
    await settle();
    expect.soft(store.state.workspace.deletionTokens[row.id]).toBe(token);
    dispatch(replaceWorkspaceList([row, second]));
    expect.soft(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(59_999);
    expect.soft(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
  });
  it.each(['timeout', 'throw'] as const)(
    'preserves a terminal target’s actual %s and continues its current sibling',
    async (outcome) => {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: Error) => void;
      mock.delete.mockReturnValueOnce(
        new Promise((a, b) => {
          resolve = a;
          reject = b;
        }),
      );
      const dispatch = await startBulk();
      dispatch(workspaceDeleted(row.id, []));
      if (outcome === 'throw') reject(new Error('actual transport failure'));
      else resolve({ success: false, error: 'delete timed out' });
      await settle();
      expect(mock.delete.mock.calls).toEqual([
        [row.id, undefined],
        [second.id, undefined],
      ]);
      expect(mock.notify.success).toHaveBeenCalledTimes(1);
      expect(mock.notify.info).toHaveBeenCalledTimes(outcome === 'timeout' ? 1 : 0);
      expect(mock.notify.error).toHaveBeenCalledTimes(outcome === 'throw' ? 1 : 0);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
    },
  );
  it('starts terminal failure grace at its reply while the next RPC is still held', async () => {
    let first!: (value: unknown) => void, last!: (value: unknown) => void;
    mock.delete
      .mockReturnValueOnce(new Promise((r) => (first = r)))
      .mockReturnValueOnce(new Promise((r) => (last = r)));
    const dispatch = await startBulk();
    dispatch(workspaceDeleted(row.id, []));
    first({ success: false, error: 'actual failure' });
    await settle();
    expect(mock.delete).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_999);
    dispatch(replaceWorkspaceList([row, second]));
    expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
    last({ success: true });
    await settle();
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
    expect(mock.notify.error).toHaveBeenCalledTimes(1);
    expect(mock.notify.success).toHaveBeenCalledTimes(1);
  });
  it('retains removal observed after a failed reply while the original bulk is still active', async () => {
    let last!: (value: unknown) => void;
    mock.delete
      .mockResolvedValueOnce({ success: false, error: 'actual failure' })
      .mockReturnValueOnce(new Promise((r) => (last = r)));
    const dispatch = await startBulk();
    expect(mock.delete).toHaveBeenCalledTimes(2);
    dispatch(workspaceDeleted(row.id, []));
    last({ success: true });
    await settle();
    dispatch(replaceWorkspaceList([row, second]));
    expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
    expect(mock.notify.error).toHaveBeenCalledTimes(1);
    expect(mock.notify.success).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
  });
  it('does not send another mutation for a queued target already authoritatively removed', async () => {
    let resolve!: (value: unknown) => void;
    mock.delete.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const dispatch = await startBulk();
    dispatch(workspaceDeleted(second.id, []));
    resolve({ success: true });
    await settle();
    expect(mock.delete).toHaveBeenCalledExactlyOnceWith(row.id, undefined);
    expect(mock.notify.success).toHaveBeenCalledTimes(1);
    expect((await workspaceClient.delete(second.id)).ok).toBe(false);
    expect((await workspaceClient.cancelDelete(second.id)).ok).toBe(false);
    expect(mock.delete).toHaveBeenCalledTimes(1);
    expect(mock.cancelDelete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(store.state.workspace.pendingDeletions[second.id]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.state.workspace.pendingDeletions[second.id]).toBeUndefined();
  });
  it('cancelled held terminal delete keeps only owned grace and ignores a late reply', async () => {
    let resolve!: (value: unknown) => void;
    mock.delete.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const dispatch = await startBulk();
    dispatch(workspaceDeleted(row.id, []));
    task!.cancel();
    await task!.toPromise();
    await settle();
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    expect(store.state.workspace.pendingDeletions[second.id]).toBeUndefined();
    expect(store.state.workspaceOperations.bulkOperationInFlight).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    resolve({ success: true });
    await settle();
    expect(mock.delete).toHaveBeenCalledTimes(1);
    expect(mock.notify.success).not.toHaveBeenCalled();
    expect(mock.notify.error).not.toHaveBeenCalled();
    dispatch(replaceWorkspaceList([row, second]));
    expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(54_999);
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
  });
  it.each(['before', 'after'] as const)(
    'does not let terminal receipt clear a %s capability denial',
    async (timing) => {
      let resolve!: (value: unknown) => void;
      mock.delete.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const dispatch = await startBulk();
      const deny = () => dispatch(replaceWorkspaceList([{ ...row, canManage: false }, second]));
      if (timing === 'before') deny();
      dispatch(workspaceDeleted(row.id, []));
      if (timing === 'after') deny();
      dispatch(workspaceDeleted(row.id, []));
      resolve({ success: true });
      await settle();
      expect(mock.delete).toHaveBeenCalledTimes(1);
      expect(mock.notify.success).not.toHaveBeenCalled();
      expect(mock.notify.error).not.toHaveBeenCalled();
      dispatch(replaceWorkspaceList([row, second]));
      expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
    },
  );
  it.each(['unshared', 'replaced'] as const)(
    'does not treat a %s purge as a terminal deletion receipt',
    async (cause) => {
      let resolve!: (value: unknown) => void;
      mock.delete.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const dispatch = await startBulk();
      dispatch(workspaceDeleted(row.id, [], cause));
      resolve({ success: true });
      await settle();
      expect(mock.delete).toHaveBeenCalledTimes(1);
      expect(mock.notify.success).not.toHaveBeenCalled();
      expect(mock.notify.error).not.toHaveBeenCalled();
      expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
    },
  );
  it.each(['readmission', 'backend', 'store', 'new token'] as const)(
    'a terminal receipt from %s cannot settle the original bulk',
    async (change) => {
      let resolve!: (value: unknown) => void;
      mock.delete.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const dispatch = await startBulk();
      if (change === 'store') {
        dispose();
        dispose = store.init();
        admitLegacyPrincipal();
        store.dispatch(setLabsMultiplayerEnabled(true));
        admit('member');
        loaded();
      } else if (change === 'backend') dispatch(backendReconnected());
      else if (change === 'readmission') {
        dispatch(
          hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }),
        );
        admit('member', 2);
        loaded();
      }
      store.dispatch(clearWorkspacePendingDeletion(row.id));
      store.dispatch(markWorkspacePendingDeletion(row.id, 'new-terminal'));
      store.dispatch(workspaceDeleted(row.id, []));
      resolve({ success: true });
      await settle();
      expect(mock.delete).toHaveBeenCalledTimes(1);
      expect(store.state.workspace.deletionTokens[row.id]).toBe('new-terminal');
      expect(mock.notify.success).not.toHaveBeenCalled();
      expect(mock.notify.error).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(store.state.workspace.deletionTokens[row.id]).toBe('new-terminal');
    },
  );
  it.each(
    ['readmission', 'backend', 'store'].flatMap((change) =>
      [true, false].map((success) => ({ change, success })),
    ),
  )('stops the old tail after $change / success=$success', async ({ change, success }) => {
    let resolve!: (v: unknown) => void;
    mock.delete.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const dispatch = await startBulk();
    expect(mock.delete).toHaveBeenCalledTimes(1);
    if (change === 'store') {
      dispose();
      dispose = store.init();
      admitLegacyPrincipal();
      store.dispatch(setLabsMultiplayerEnabled(true));
    } else if (change === 'backend') dispatch(backendReconnected());
    else
      dispatch(hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }));
    admit('member', 2);
    loaded();
    for (const w of [row, second]) {
      store.dispatch(clearWorkspacePendingDeletion(w.id));
      store.dispatch(setWorkspaceEntity({ ...w, title: 'New ' + w.title }));
      store.dispatch(markWorkspacePendingDeletion(w.id, 'new-' + w.id));
    }
    store.dispatch(bulkOperationFinished());
    store.dispatch(bulkOperationStarted({ kind: 'delete', workspaceIds: [second.id] }));
    resolve({ success, ...(success ? {} : { error: 'late failure' }) });
    await settle();
    expect(mock.delete).toHaveBeenCalledTimes(1);
    expect(store.state.workspace.deletionTokens[second.id]).toBe('new-' + second.id);
    expect(store.state.workspace.deletionTokens[row.id]).toBe('new-' + row.id);
    expect(store.state.workspaceOperations.bulkOperationInFlight).toBe(true);
    expect(mock.notify.success).not.toHaveBeenCalled();
    expect(mock.notify.error).not.toHaveBeenCalled();
    expect(mock.notify.info).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(store.state.workspace.deletionTokens[row.id]).toBe('new-' + row.id);
  });
  it('preserves partial success and settles only the failed target', async () => {
    mock.delete
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'ordinary failure' });
    await startBulk();
    expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
    expect(getItem(store.state.workspace.workspaces, second.id)?.title).toBe('Second');
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    expect(store.state.workspace.pendingDeletions[second.id]).toBeUndefined();
    expect(mock.notify.success).toHaveBeenCalledTimes(1);
    expect(mock.notify.error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(store.state.workspace.pendingDeletions).toEqual({});
  });
  it('cancelled bulk retains the completed target grace and releases the unfinished target', async () => {
    mock.delete
      .mockResolvedValueOnce({ success: true })
      .mockImplementationOnce(() => new Promise(() => {}));
    await startBulk();
    expect(mock.delete).toHaveBeenCalledTimes(2);
    task!.cancel();
    await task!.toPromise();
    await settle();
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    expect(store.state.workspace.pendingDeletions[second.id]).toBeUndefined();
    expect(store.state.workspaceOperations.bulkOperationInFlight).toBe(false);
    expect(mock.notify.success).not.toHaveBeenCalled();
    expect(mock.notify.error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(store.state.workspace.pendingDeletions[row.id]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
  });
  it.each([true, false])(
    'settles ordinary bulk result success=%s and owned expiry',
    async (success) => {
      mock.delete.mockResolvedValue({ success, ...(success ? {} : { error: 'ordinary failure' }) });
      await startBulk();
      expect(mock.delete.mock.calls).toEqual([
        [row.id, undefined],
        [second.id, undefined],
      ]);
      expect(store.state.workspaceOperations.bulkOperationInFlight).toBe(false);
      expect(mock.notify.success).toHaveBeenCalledTimes(success ? 1 : 0);
      expect(mock.notify.error).toHaveBeenCalledTimes(success ? 0 : 1);
      expect(getItem(store.state.workspace.workspaces, second.id)?.title).toBe(
        success ? undefined : 'Second',
      );
      await vi.advanceTimersByTimeAsync(60_001);
      expect(store.state.workspace.pendingDeletions).toEqual({});
    },
  );
});

describe('residual authoritative list and pending rollback', () => {
  it.each(['delete', 'undo'] as const)(
    'does not restore after same-ID denial during %s',
    async (phase) => {
      let resolve!: (v: unknown) => void;
      (phase === 'delete' ? mock.delete : mock.cancelDelete).mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const dispatch = start();
      await settle();
      if (phase === 'undo') {
        mock.notify.warning.mock.calls[0][1].action.onClick();
        await settle();
      }
      dispatch(replaceWorkspaceList([{ ...row, canManage: false }]));
      resolve(
        phase === 'delete' ? { success: false, error: 'late' } : { success: true, cancelled: true },
      );
      await settle();
      expect(getItem(store.state.workspace.workspaces, row.id)).toBeUndefined();
      expect(mock.notify.error).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(store.state.workspace.pendingDeletions[row.id]).toBeUndefined();
    },
  );
  it.each(['full absence', 'partial absence', 'true capability'] as const)(
    'honors %s without inventing omission authority',
    async (kind) => {
      let resolve!: (v: unknown) => void;
      mock.delete.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const dispatch = start();
      await settle();
      const tokens = { ...store.state.workspace.deletionTokens };
      dispatch(
        Reflect.apply(replaceWorkspaceList, null, [
          kind === 'true capability' ? [row] : [],
          { complete: kind === 'full absence', deletionTokens: tokens },
        ]),
      );
      resolve({ success: false, error: 'ordinary failure' });
      await settle();
      expect(getItem(store.state.workspace.workspaces, row.id)?.title).toBe(
        kind === 'full absence' ? undefined : 'Original',
      );
      expect(mock.notify.error).toHaveBeenCalledTimes(kind === 'full absence' ? 0 : 1);
    },
  );
});

describe('residual scoped guest-owner protected workspace.update', () => {
  it.each(['branch', 'baseCommitSha', 'status'])(
    'permits current scoped owner field %s without direct lifecycle grant',
    async (field) => {
      admit('guest');
      store.dispatch(setWorkspaceEntity({ ...row, myRole: 'owner' }));
      loaded();
      const request = { id: row.id, [field]: field === 'status' ? 'archived' : 'value' };
      expect((await workspaceClient.update(request)).ok).toBe(true);
      expect(mock.update).toHaveBeenCalledExactlyOnceWith(request);
      expect((await workspaceClient.delete(row.id)).ok).toBe(false);
      expect((await workspaceClient.cancelDelete(row.id)).ok).toBe(false);
      expect((await workspaceClient.archive(row.id)).ok).toBe(false);
      expect((await workspaceClient.unarchive(row.id)).ok).toBe(false);
      expect(mock.archive).not.toHaveBeenCalled();
      expect(mock.unarchive).not.toHaveBeenCalled();
      expect(mock.delete).not.toHaveBeenCalled();
      expect(mock.cancelDelete).not.toHaveBeenCalled();
    },
  );
});

describe('real list client and lifecycle projection completeness', () => {
  it.each(['complete array', 'partial page', 'explicit denial'] as const)(
    '%s reconciles held deletion before rollback',
    async (kind) => {
      const { registerMockIpcHandler, unregisterMockIpcHandler } =
        await import('$shared/ipc-mock-router');
      const { WORKSPACE_CHANNELS } = await import('$shared/ipc/channels');
      const { lifecycleReadSaga } =
        await import('../workspace-lifecycle/sagas/lifecycle-read-saga');
      const { loadWorkspacesRequested } = await import('./workspace-slice');
      let resolve!: (x: unknown) => void;
      mock.delete.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      start();
      await settle();
      workspaceClient.clearCache();
      registerMockIpcHandler(WORKSPACE_CHANNELS.LIST, async () => ({
        success: true,
        data:
          kind === 'complete array'
            ? []
            : {
                workspaces: kind === 'explicit denial' ? [{ ...row, canManage: false }] : [],
                total: 10,
                hasMore: true,
              },
      }));
      const channel = stdChannel();
      const dispatch = (a: Parameters<typeof store.dispatch>[0]) => {
        store.dispatch(a);
        channel.put(a);
      };
      const reader = runSaga({ channel, dispatch, getState: () => store.state }, lifecycleReadSaga);
      try {
        dispatch(loadWorkspacesRequested());
        await settle();
        resolve({ success: false, error: 'held failure' });
        await settle();
        expect(getItem(store.state.workspace.workspaces, row.id)?.title).toBe(
          kind === 'partial page' ? 'Original' : undefined,
        );
        expect(mock.notify.error).toHaveBeenCalledTimes(kind === 'partial page' ? 1 : 0);
      } finally {
        reader.cancel();
        await reader.toPromise();
        unregisterMockIpcHandler(WORKSPACE_CHANNELS.LIST);
        workspaceClient.clearCache();
      }
    },
  );
  it('a full-list read cannot invalidate a replacement deletion token', () => {
    store.dispatch(markWorkspacePendingDeletion(row.id, 'earlier'));
    const captured = { ...store.state.workspace.deletionTokens };
    store.dispatch(clearWorkspacePendingDeletion(row.id, 'earlier'));
    store.dispatch(markWorkspacePendingDeletion(row.id, 'later'));
    store.dispatch(replaceWorkspaceList([], { complete: true, deletionTokens: captured }));
    expect(store.state.workspace.invalidatedDeletions[row.id]).toBeUndefined();
    expect(store.state.workspace.deletionTokens[row.id]).toBe('later');
  });
});
