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
import { requestDeleteWorkspace } from '../workspace-operations/workspace-operations-slice';
import { workspaceOperationsSaga } from '../workspace-operations/sagas/workspace-operations-saga';
import {
  backendReconnected,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import { workspaceClient } from './utils/workspace.client';
import type { Workspace } from '$shared/types';
const mock = vi.hoisted(() => ({
  delete: vi.fn(),
  cancelDelete: vi.fn(),
  update: vi.fn(),
  terminal: vi.fn(),
  script: vi.fn(),
  notify: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
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
  it('guest owner cannot update lifecycle fields', async () => {
    admit('guest');
    store.dispatch(setWorkspaceEntity({ ...row, myRole: 'owner' }));
    loaded();
    expect((await workspaceClient.update({ id: row.id, status: 'archived' } as never)).ok).toBe(
      false,
    );
    expect(mock.update).not.toHaveBeenCalled();
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
