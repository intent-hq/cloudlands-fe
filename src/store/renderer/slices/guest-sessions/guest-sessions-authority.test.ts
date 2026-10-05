import { describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withHostPrincipal, withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import { initialState as guestSessions } from './guest-sessions-slice';
import { initialState as workspace } from '../workspace/workspace-slice';
import {
  selectCanManageHostedWorkspace,
  selectHostedWorkspaces,
  selectHostedPendingInviteCount,
  selectJoinedInstanceSessions,
  selectJoinedWorkspaceSessions,
} from './guest-sessions-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import type { GuestSessionRecord, WorkspaceMember } from './guest-sessions-types';
function stateFor(role: 'owner' | 'member' | 'guest', canManage: boolean) {
  const state = withHostPrincipal(
    {
      guestSessions,
      workspace: {
        ...workspace,
        hasLoaded: true,
        loadedBackendId: 'local',
        workspaces: createCollection('id', [
          {
            id: WorkspaceId('ws'),
            myRole: role === 'member' ? 'collaborator' : 'owner',
            canManage,
            memberCount: 3,
          } as Workspace,
        ]),
      },
    },
    role,
  );
  state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
  return state;
}
describe('Settings workspace sharing authority', () => {
  it('lists manageable workspaces for a member retaining myRole collaborator (#6390)', () => {
    const state = stateFor('member', true);
    expect(selectCanManageHostedWorkspace.select(state, 'ws')).toBe(true);
    expect(selectHostedWorkspaces.select(state).map((w) => w.id)).toEqual(['ws']);
  });
  it('rejects cached owner metadata, unknown authority, disabled Multiplayer and stale capability snapshots', () => {
    const state = stateFor('guest', false);
    expect(selectHostedWorkspaces.select(state)).toEqual([]);
    const admitted = stateFor('owner', true);
    for (const changed of [
      {
        ...admitted,
        userPreferences: { ...admitted.userPreferences, labsMultiplayerEnabled: false },
      },
      { ...admitted, workspace: { ...admitted.workspace, capabilityContext: 'old' } },
      { ...admitted, principal: { ...admitted.principal, status: 'unknown' as const } },
    ])
      expect(selectCanManageHostedWorkspace.select(changed, 'ws')).toBe(false);
  });
  it('retains admitted legacy owner behavior without inventing host membership', () => {
    const state = withLegacyPrincipal({
      guestSessions,
      workspace: {
        ...workspace,
        workspaces: createCollection('id', [
          { id: WorkspaceId('ws'), memberCount: 2 } as Workspace,
        ]),
      },
    });
    expect(selectCanManageHostedWorkspace.select(state, 'ws')).toBe(true);
  });
});

describe('Collaboration list contents', () => {
  const member = (principalId: string, hostRole: WorkspaceMember['hostRole']): WorkspaceMember => ({
    principalId,
    hostRole,
    role: 'collaborator',
    login: 'same-login',
    displayName: null,
    avatarUrl: null,
    addedAt: '2026-10-03',
  });
  it('counts only accepted workspace guests and retains pending-only sharing', () => {
    const state = stateFor('owner', true);
    state.guestSessions = {
      ...guestSessions,
      hostedRosters: {
        ws: {
          status: 'loaded',
          members: [member('instance', 'member')],
          guestCount: 0,
          guestLimit: 10,
        },
      },
    };
    expect(selectHostedWorkspaces.select(state)).toEqual([]);
    state.guestSessions.hostedRosters.ws = {
      ...state.guestSessions.hostedRosters.ws,
      guestCount: 1,
    };
    expect(selectHostedPendingInviteCount.select(state, 'ws')).toBe(1);
    expect(selectHostedWorkspaces.select(state).map((w) => w.id)).toEqual(['ws']);
    state.guestSessions.hostedRosters.ws = {
      ...state.guestSessions.hostedRosters.ws,
      members: [member('instance', 'member'), member('guest', 'guest')],
    };
    expect(selectHostedPendingInviteCount.select(state, 'ws')).toBe(0);
    expect(selectHostedWorkspaces.select(state).map((w) => w.id)).toEqual(['ws']);
  });
  it('does not present loading, failed, or missing invitation capability as no sharing', () => {
    const state = stateFor('owner', true);
    for (const status of ['loading', 'error', 'loaded'] as const) {
      state.guestSessions = { ...guestSessions, hostedRosters: { ws: { status, members: [] } } };
      expect(selectHostedPendingInviteCount.select(state, 'ws')).toBeNull();
      expect(selectHostedWorkspaces.select(state).map((w) => w.id)).toEqual(['ws']);
    }
  });
  it('partitions by saved session IDs, with current admitted principal overriding the saved role', () => {
    const state = stateFor('guest', false);
    const currentId = state.connections.windowBackendId;
    const currentPrincipal = state.principal.snapshot!.principal.id;
    const sessions = [
      { id: currentId, principalId: currentPrincipal, hostRole: 'member', login: 'same-login' },
      { id: 'other-instance', principalId: 'other', hostRole: 'member', login: 'same-login' },
      { id: 'workspace-only', principalId: 'direct', hostRole: 'guest', login: 'same-login' },
    ] as GuestSessionRecord[];
    state.guestSessions = { ...guestSessions, sessions: createCollection('id', sessions) };
    expect(selectJoinedInstanceSessions.select(state).map((s) => s.id)).toEqual(['other-instance']);
    expect(selectJoinedWorkspaceSessions.select(state).map((s) => s.id)).toEqual([
      currentId,
      'workspace-only',
    ]);
    const admitted = withHostPrincipal(state, 'member');
    expect(selectJoinedInstanceSessions.select(admitted).map((s) => s.id)).toEqual([
      currentId,
      'other-instance',
    ]);
    expect(selectJoinedWorkspaceSessions.select(admitted).map((s) => s.id)).toEqual([
      'workspace-only',
    ]);
  });
});
