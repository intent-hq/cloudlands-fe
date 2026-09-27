import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';
import { getItems, createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { initialState as workspace } from '../../workspace/workspace-slice';
import { selectPrincipalAdmissionContext } from '../../principal/principal-selectors';
import { selectPermissionReadContext, selectPermissionRequests } from '../permission-selectors';
import {
  initialState,
  permissionReducer,
  permissionRequestReceived,
  removePermissionRequest,
  type PermissionRequest,
} from '../permission-slice';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
import { hydratePermissions } from './permission-read-saga';

const request = (id: string, sessionId = 'agent'): PermissionRequest => ({
  requestId: id,
  sessionId,
  title: 'Run command',
  options: [],
  timestamp: 1,
});

function harness() {
  let state = withLegacyPrincipal({
    workspace: {
      ...workspace,
      hasLoaded: true,
      loadedBackendId: 'local',
      workspaces: createCollection('id', [
        { id: WorkspaceId('ws'), canManage: true, myRole: 'collaborator' } as Workspace,
      ]),
    },
    agentSessions: { byAgentId: { agent: { workspaceId: WorkspaceId('ws') } } },
    permission: initialState,
  });
  state.principal.snapshot!.capabilities.hostMembership = true;
  state.principal.snapshot!.principal.hostRole = 'member';
  state.principal.snapshot!.principal.isAdministrator = false;
  const dispatch = (action: Parameters<typeof permissionReducer>[1]) => {
    state = { ...state, permission: permissionReducer(state.permission, action) };
  };
  return {
    getState: () => state,
    setState: (next: typeof state) => {
      state = next;
    },
    dispatch,
    run: () =>
      runSaga({ getState: () => state, dispatch }, hydratePermissions, {
        payload: selectPermissionReadContext.select(state),
      }),
  };
}

describe('pending permission recovery', () => {
  afterEach(() => vi.clearAllMocks());

  it('recovers only owned workspace prompts for an explicitly granted guest owner', async () => {
    const h = harness();
    const state = h.getState();
    state.principal.snapshot!.principal.hostRole = 'guest';
    state.workspace.workspaces = createCollection('id', [
      { id: WorkspaceId('ws'), myRole: 'owner', canManage: true } as Workspace,
    ]);
    state.workspace.loadedPrincipalContext = selectPrincipalAdmissionContext.select(state);
    mocks.request.mockResolvedValue({ requests: [request('owned'), request('unmapped', 'other')] });
    await h.run().toPromise();
    expect(mocks.request).toHaveBeenCalledWith('agent.pendingPermissions', {});
    expect(selectPermissionRequests.select(state)).toEqual([]);
    expect(selectPermissionRequests.select(h.getState()).map((r) => r.requestId)).toEqual([
      'owned',
    ]);
    h.getState().workspace.loadedPrincipalContext = null;
    expect(selectPermissionRequests.select(h.getState())).toEqual([]);
  });

  it('recovers a member prompt and exposes only manageable known workspace agents', async () => {
    mocks.request.mockResolvedValue({ requests: [request('mine'), request('unmapped', 'other')] });
    const h = harness();
    await h.run().toPromise();
    expect(mocks.request).toHaveBeenCalledWith('agent.pendingPermissions', {});
    expect(selectPermissionRequests.select(h.getState()).map((r) => r.requestId)).toEqual(['mine']);
    h.setState({
      ...h.getState(),
      workspace: { ...h.getState().workspace, loadedBackendId: 'other' },
    });
    expect(selectPermissionRequests.select(h.getState())).toEqual([]);
  });

  it.each(['guest', 'unknown', 'lab-off'] as const)(
    'does not list permissions for %s presentation',
    async (kind) => {
      const h = harness();
      const state = h.getState();
      if (kind === 'guest') state.principal.snapshot!.principal.hostRole = 'guest';
      if (kind === 'unknown') state.principal.status = 'unknown';
      if (kind === 'lab-off') state.userPreferences.labsMultiplayerEnabled = false;
      await h.run().toPromise();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each(['other-host', 'reconnect', 'revoked', 'lab-off'] as const)(
    'ignores a pending snapshot after %s',
    async (change) => {
      let resolve!: (value: { requests: PermissionRequest[] }) => void;
      mocks.request.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const h = harness();
      const task = h.run();
      const state = h.getState();
      if (change === 'other-host') state.connections.windowBackendId = 'other';
      if (change === 'reconnect') state.daemonHealth.connectionGeneration += 1;
      if (change === 'revoked') state.principal.status = 'revoked';
      if (change === 'lab-off') state.userPreferences.labsMultiplayerEnabled = false;
      resolve({ requests: [request('old')] });
      await task.toPromise();
      expect(getItems(h.getState().permission.requests)).toEqual([]);
    },
  );

  it('refetches when a live resolution overtakes the initial snapshot', async () => {
    let resolve!: (value: { requests: PermissionRequest[] }) => void;
    mocks.request
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce({ requests: [request('live')] });
    const h = harness();
    const task = h.run();
    h.dispatch(permissionRequestReceived(request('live')));
    h.dispatch(removePermissionRequest('resolved-before-hydration'));
    resolve({ requests: [request('resolved-before-hydration')] });
    await task.toPromise();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(selectPermissionRequests.select(h.getState()).map((r) => r.requestId)).toEqual(['live']);
  });
});
