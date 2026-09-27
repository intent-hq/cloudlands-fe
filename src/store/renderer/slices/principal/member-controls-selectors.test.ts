import { describe, expect, it } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import type { HostRole } from '$shared/types/principal';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { initialState as workspace } from '../workspace/workspace-slice';
import {
  selectCanAdministerHost,
  selectCanCreateWorkspace,
  selectHostAdministrationDenied,
  selectIsWorkspaceGuest,
  selectWorkspaceControlContext,
  selectWorkspaceCreationVisible,
} from './principal-selectors';
import {
  selectCanManageWorkspace,
  selectCanShareWorkspace,
  selectIsCollaboratorOnlyClient,
  selectIsWorkspaceOwner,
  selectWorkspaceManagementContext,
  selectWorkspaceManagementDenied,
} from '../workspace/workspace-selectors';

function admitted(role: HostRole, multiplayer: boolean | undefined = true) {
  const state = withLegacyPrincipal({
    workspace: {
      ...workspace,
      hasLoaded: true,
      loadedBackendId: 'host-a',
      workspaces: createCollection('id', [
        { id: WorkspaceId('ws'), myRole: 'collaborator', canManage: role !== 'guest' } as Workspace,
      ]),
    },
    connections: { windowBackendId: 'host-a' },
    userPreferences: { labsMultiplayerEnabled: multiplayer },
  });
  state.principal.snapshot!.principal = {
    ...state.principal.snapshot!.principal,
    isAdministrator: role === 'owner',
    hostRole: role,
    hostMembershipRevision: 1,
  };
  state.principal.snapshot!.capabilities.hostMembership = true;
  return state;
}

describe('member workspace controls', () => {
  it.each(['owner', 'member', 'guest'] as const)(
    'separates %s management from ownership and host administration',
    (role) => {
      const state = admitted(role);
      expect(selectCanCreateWorkspace.select(state)).toBe(role !== 'guest');
      expect(selectWorkspaceCreationVisible.select(state)).toBe(role !== 'guest');
      expect(selectCanManageWorkspace.select(state, 'ws')).toBe(role !== 'guest');
      expect(selectCanShareWorkspace.select(state, 'ws')).toBe(role !== 'guest');
      expect(selectCanAdministerHost.select(state)).toBe(role === 'owner');
      expect(selectIsCollaboratorOnlyClient.select(state)).toBe(role !== 'owner');
      expect(selectIsWorkspaceOwner.select(state, 'ws')).toBe(false);
      expect(selectIsWorkspaceGuest.select(state)).toBe(role === 'guest');
      expect(selectWorkspaceManagementContext.select(state, '__chief__') !== null).toBe(
        role === 'owner',
      );
    },
  );

  it.each([false, undefined])(
    'hides experimental member work with Multiplayer=%s without denying authority',
    (lab) => {
      const state = admitted('member', lab);
      state.userPreferences.labsMultiplayerEnabled = lab;
      expect(selectCanCreateWorkspace.select(state)).toBe(true);
      expect(selectCanManageWorkspace.select(state, 'ws')).toBe(true);
      expect(selectWorkspaceCreationVisible.select(state)).toBe(false);
      expect(selectWorkspaceManagementContext.select(state, 'ws')).toBeNull();
      expect(selectWorkspaceManagementDenied.select(state, 'ws')).toBe(false);
      expect(selectCanShareWorkspace.select(state, 'ws')).toBe(false);
      const owner = admitted('owner', lab);
      owner.userPreferences.labsMultiplayerEnabled = lab;
      expect(selectWorkspaceCreationVisible.select(owner)).toBe(true);
      expect(selectWorkspaceManagementContext.select(owner, 'ws')).not.toBeNull();
      expect(selectCanShareWorkspace.select(owner, 'ws')).toBe(false);
    },
  );

  it.each(['other-host', 'reconnect', 'revoked', 'unknown', 'stale-list'] as const)(
    'withholds controls after %s and cleans saved layout only on confirmed denial',
    (change) => {
      const state = admitted('member');
      if (change === 'other-host') state.connections.windowBackendId = 'host-b';
      if (change === 'reconnect') state.daemonHealth.connectionGeneration += 1;
      if (change === 'revoked') state.principal.status = 'revoked';
      if (change === 'unknown') state.principal.status = 'unknown';
      if (change === 'stale-list') state.workspace.loadedBackendId = 'host-b';
      expect(selectWorkspaceManagementContext.select(state, 'ws')).toBeNull();
      expect(selectWorkspaceManagementDenied.select(state, 'ws')).toBe(change === 'revoked');
      expect(selectHostAdministrationDenied.select(state)).toBe(
        change === 'revoked' || change === 'stale-list',
      );
    },
  );

  it('requires a fresh presentation read after re-enabling Multiplayer', () => {
    const state = admitted('member');
    const previous = selectWorkspaceControlContext.select(state);
    state.principal.presentationVersion += 1;
    expect(selectWorkspaceControlContext.select(state)).toBeNull();
    state.principal.refreshedPresentationVersion = state.principal.presentationVersion;
    expect(selectWorkspaceControlContext.select(state)).not.toBeNull();
    expect(selectWorkspaceControlContext.select(state)).not.toBe(previous);
  });

  it('preserves ordinary owner operations through a Multiplayer toggle', () => {
    const state = admitted('owner');
    const context = selectWorkspaceControlContext.select(state);
    state.userPreferences.labsMultiplayerEnabled = false;
    state.principal.presentationVersion += 1;
    expect(selectWorkspaceControlContext.select(state)).toBe(context);
  });
});
