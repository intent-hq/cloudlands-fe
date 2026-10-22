import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { store } from '../../../store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { principalReceived, hostMembershipChanged } from '../../principal/principal-slice';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import {
  setWorkspaceEntity,
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
  setWorkspaceHasLoaded,
  loadWorkspacesRequested,
} from '../../workspace/workspace-slice';
import {
  selectCanManageWorkspace,
  selectWorkspaceManagementDenied,
  selectWorkspaceById,
} from '../../workspace/workspace-selectors';
import { workspaceDeleted, backendReconnected } from '../workspace-lifecycle-slice';
import type { Workspace } from '$shared/types';
const mock = vi.hoisted(() => ({ list: vi.fn(), recent: vi.fn(async () => ({})) }));
vi.mock('../../workspace/utils/workspace.client', () => ({ workspaceClient: { list: mock.list } }));
vi.mock('$lib/client', () => ({ appClient: { workspaces: { recentViews: mock.recent } } }));
vi.mock('../../workspace-share/sagas/workspace-share-saga', () => ({
  refreshIntegrationAuthAfterReconnect: vi.fn(),
}));
import { lifecycleReadSaga } from './lifecycle-read-saga';
const row = {
  id: 'ws-projection',
  title: 'old',
  myRole: 'collaborator',
  canManage: true,
} as Workspace;
let dispose: () => void, task: Task, channel: ReturnType<typeof stdChannel>;
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function admit(role: 'member' | 'guest', revision: number) {
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
          isAdministrator: false,
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
function dispatch(a: Parameters<typeof store.dispatch>[0]) {
  store.dispatch(a);
  channel.put(a);
}
beforeEach(() => {
  vi.clearAllMocks();
  dispose = store.init();
  admitLegacyPrincipal();
  store.dispatch(setLabsMultiplayerEnabled(true));
  admit('member', 1);
  store.dispatch(setWorkspaceEntity(row));
  store.dispatch(
    setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
  );
  channel = stdChannel();
  task = runSaga({ channel, dispatch, getState: () => store.state }, lifecycleReadSaga);
});
afterEach(async () => {
  task.cancel();
  await task.toPromise();
  dispose();
});
describe('current capability list request, result and event authority', () => {
  it.each([true, false])(
    'holds guest rights until current canManage=%s arrives',
    async (canManage) => {
      let resolve!: (x: unknown) => void;
      mock.list.mockReturnValue(new Promise((r) => (resolve = r)));
      dispatch(hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }));
      admit('guest', 2);
      dispatch(loadWorkspacesRequested());
      await settle();
      expect(selectCanManageWorkspace.select(store.state, row.id)).toBe(false);
      expect(selectWorkspaceManagementDenied.select(store.state, row.id)).toBe(false);
      expect(selectWorkspaceById.select(store.state, row.id)).toBeDefined();
      resolve({ ok: true, data: [{ ...row, canManage }] });
      await settle();
      expect(selectCanManageWorkspace.select(store.state, row.id)).toBe(canManage);
      expect(selectWorkspaceManagementDenied.select(store.state, row.id)).toBe(!canManage);
    },
  );
  it('failed guest refresh leaves projection unresolved and preserves the saved row', async () => {
    mock.list.mockResolvedValue({ ok: false, error: 'FORBIDDEN' });
    dispatch(hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }));
    admit('guest', 2);
    dispatch(loadWorkspacesRequested());
    await settle();
    expect(selectCanManageWorkspace.select(store.state, row.id)).toBe(false);
    expect(selectWorkspaceManagementDenied.select(store.state, row.id)).toBe(false);
    expect(selectWorkspaceById.select(store.state, row.id)).toBeDefined();
  });
  it('late member list cannot overwrite a readmitted guest context', async () => {
    let resolve!: (x: unknown) => void;
    mock.list.mockReturnValue(new Promise((r) => (resolve = r)));
    dispatch(loadWorkspacesRequested());
    await settle();
    dispatch(hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }));
    admit('guest', 2);
    resolve({ ok: true, data: [{ ...row, title: 'stale' }] });
    await settle();
    expect(selectWorkspaceById.select(store.state, row.id)?.title).toBe('old');
    expect(selectCanManageWorkspace.select(store.state, row.id)).toBe(false);
  });
  it('authoritative removal and update win over a held same-admission list', async () => {
    const other = { ...row, id: 'other' };
    store.dispatch(setWorkspaceEntity(other));
    let resolve!: (x: unknown) => void;
    mock.list.mockReturnValue(new Promise((r) => (resolve = r)));
    dispatch(loadWorkspacesRequested());
    await settle();
    dispatch(workspaceDeleted(row.id, []));
    dispatch(setWorkspaceEntity({ ...other, title: 'live' }));
    resolve({ ok: true, data: [row, other] });
    await settle();
    expect(selectWorkspaceById.select(store.state, row.id)).toBeUndefined();
    expect(selectWorkspaceById.select(store.state, 'other')?.title).toBe('live');
  });
  it('physical reconnect invalidates prior capability readiness', () => {
    dispatch(backendReconnected());
    expect(selectCanManageWorkspace.select(store.state, row.id)).toBe(false);
    expect(selectWorkspaceManagementDenied.select(store.state, row.id)).toBe(false);
  });
});

it('title-only live update cannot restore the old capability over current guest denial', async () => {
  dispatch(hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }));
  admit('guest', 2);
  let resolve!: (x: unknown) => void;
  mock.list.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  dispatch(loadWorkspacesRequested());
  await settle();
  dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(row.id, { title: 'live title' })]));
  resolve({ ok: true, data: [{ ...row, canManage: false }] });
  await settle();
  expect(selectWorkspaceById.select(store.state, row.id)?.title).toBe('live title');
  expect(selectCanManageWorkspace.select(store.state, row.id)).toBe(false);
  expect(selectWorkspaceManagementDenied.select(store.state, row.id)).toBe(true);
});

it('a replacement store with identical IDs does not accept the old list response', async () => {
  let resolve!: (x: unknown) => void;
  mock.list.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  dispatch(loadWorkspacesRequested());
  await settle();
  dispose();
  dispose = store.init();
  admitLegacyPrincipal();
  store.dispatch(setLabsMultiplayerEnabled(true));
  admit('member', 1);
  store.dispatch(setWorkspaceEntity({ ...row, title: 'replacement' }));
  resolve({ ok: true, data: [{ ...row, title: 'old response' }] });
  await settle();
  expect(selectWorkspaceById.select(store.state, row.id)?.title).toBe('replacement');
});
