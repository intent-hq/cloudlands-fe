import { describe, expect, it } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { initialState } from '../workspace/workspace-slice';
import {
  selectCanManageWorkspace,
  selectIsWorkspaceOwner,
  selectWorkspaceManagementDenied,
  selectWorkspaceActionContext,
  selectWorkspaceParticipationContext,
  selectWorkspacePermissionContext,
} from '../workspace/workspace-selectors';
import {
  selectCanAdministerHost,
  selectPrincipalActionContext,
  selectCanCreateWorkspace,
  selectWorkspaceCreationVisible,
} from './principal-selectors';

function guest(myRole: 'owner' | 'collaborator', canManage?: boolean) {
  return withLegacyPrincipal(
    {
      workspace: {
        ...initialState,
        hasLoaded: true,
        loadedBackendId: 'local',
        workspaces: createCollection('id', [
          { id: WorkspaceId('retained'), myRole, canManage } as Workspace,
        ]),
      },
    },
    'guest',
  );
}

describe('workspace rights stay separate from host membership', () => {
  it('retains an explicitly owned legacy workspace without host or creation authority', () => {
    const state = guest('owner');
    expect(selectCanManageWorkspace.select(state, 'retained')).toBe(true);
    expect(selectIsWorkspaceOwner.select(state, 'retained')).toBe(true);
    expect(selectWorkspaceManagementDenied.select(state, 'retained')).toBe(false);
    expect(selectCanAdministerHost.select(state)).toBe(false);
    expect(selectCanCreateWorkspace.select(state)).toBe(false);
    expect(selectCanManageWorkspace.select(state, 'another')).toBe(false);
  });

  it('honors a current explicit denial even when ownership metadata is retained', () => {
    const state = guest('owner', false);
    state.principal.snapshot!.capabilities.hostMembership = true;
    state.principal.snapshot!.principal.hostRole = 'guest';
    state.workspace.loadedBackendId = state.connections.windowBackendId;
    state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
    expect(selectCanManageWorkspace.select(state, 'retained')).toBe(false);
    expect(selectWorkspaceManagementDenied.select(state, 'retained')).toBe(true);
  });

  it('withholds unknown rights without turning them into a cleanup denial', () => {
    const state = guest('owner');
    state.principal.status = 'loading';
    expect(selectCanManageWorkspace.select(state, 'retained')).toBe(false);
    expect(selectWorkspaceManagementDenied.select(state, 'retained')).toBe(false);
  });

  it('requires current capability and lab admission for member management, not owner metadata', () => {
    const state = guest('collaborator', true);
    state.principal.snapshot!.capabilities.hostMembership = true;
    state.principal.snapshot!.principal.hostRole = 'member';
    state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
    expect(selectCanAdministerHost.select(state)).toBe(false);
    expect(selectIsWorkspaceOwner.select(state, 'retained')).toBe(false);
    expect(selectWorkspaceCreationVisible.select(state)).toBe(true);
    const context = selectWorkspaceActionContext.select(state, 'retained');
    expect(context).toBeTruthy();
    state.userPreferences.labsMultiplayerEnabled = false;
    expect(selectWorkspaceCreationVisible.select(state)).toBe(false);
    expect(selectWorkspaceActionContext.select(state, 'retained')).toBeNull();
    expect(selectWorkspaceManagementDenied.select(state, 'retained')).toBe(false);
    state.userPreferences.labsMultiplayerEnabled = true;
    state.principal.presentationVersion++;
    expect(selectWorkspaceCreationVisible.select(state)).toBe(false);
    state.principal.refreshedPresentationVersion = state.principal.presentationVersion;
    expect(selectWorkspaceActionContext.select(state, 'retained')).toBeNull();
    state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
    expect(selectWorkspaceActionContext.select(state, 'retained')).not.toBe(context);
    state.workspace.loadedBackendId = 'previous-host';
    expect(selectWorkspaceActionContext.select(state, 'retained')).toBeNull();
  });

  it('retains ordinary guest chat while using current shared-host management rights for prompts', () => {
    const state = guest('collaborator', false);
    expect(selectWorkspaceParticipationContext.select(state, 'retained')).toBeTruthy();
    expect(selectWorkspacePermissionContext.select(state, 'retained')).toBeTruthy();
    state.principal.snapshot!.capabilities.hostMembership = true;
    state.principal.snapshot!.principal.hostRole = 'guest';
    state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
    expect(selectWorkspaceParticipationContext.select(state, 'retained')).toBeTruthy();
    expect(selectWorkspacePermissionContext.select(state, 'retained')).toBeNull();
    expect(selectWorkspaceCreationVisible.select(state)).toBe(false);
  });

  it('keeps ordinary owner creation available with Multiplayer off', () => {
    const state = withLegacyPrincipal({});
    state.userPreferences.labsMultiplayerEnabled = false;
    expect(selectWorkspaceCreationVisible.select(state)).toBe(true);
  });
});
