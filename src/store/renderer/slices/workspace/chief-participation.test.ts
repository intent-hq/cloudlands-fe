import { describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { createChiefVirtualWorkspace } from '../workspace-agents/chief-virtual-workspace';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import type { PrincipalState } from '../principal/principal-types';
import { initialState } from './workspace-slice';
import { selectWorkspaceParticipationContext } from './workspace-selectors';

function owner(hostMembership: boolean) {
  const state = withLegacyPrincipal({
    workspace: {
      ...initialState,
      workspaces: createCollection('id', [createChiefVirtualWorkspace()]),
    },
  });
  if (hostMembership) {
    state.principal.snapshot!.capabilities.hostMembership = true;
    state.principal.snapshot!.principal.hostRole = 'owner';
    state.principal.snapshot!.principal.hostMembershipRevision = 1;
  }
  return state;
}

describe('Chief participation uses the current host owner', () => {
  it.each([false, true])(
    'admits an owner without ordinary workspace capabilities or Multiplayer (hostMembership=%s)',
    (hostMembership) => {
      const state = owner(hostMembership);
      state.userPreferences.labsMultiplayerEnabled = false;
      expect(selectWorkspaceParticipationContext.select(state, CHIEF_WORKSPACE_ID)).toBe(
        selectPrincipalActionContext.select(state),
      );
      expect(selectWorkspaceParticipationContext.select(state, CHIEF_WORKSPACE_ID)).toBeTruthy();
    },
  );

  it.each(['member', 'guest'] as const)(
    'refuses a %s despite retained Chief ownership and management fields',
    (role) => {
      const state = owner(true);
      state.principal.snapshot!.principal.hostRole = role;
      state.principal.snapshot!.principal.isAdministrator = false;
      state.workspace.workspaces = createCollection('id', [
        { ...createChiefVirtualWorkspace(), myRole: 'owner', canManage: true },
      ]);
      state.workspace.hasLoaded = true;
      state.workspace.loadedBackendId = state.connections.windowBackendId;
      state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
      expect(selectWorkspaceParticipationContext.select(state, CHIEF_WORKSPACE_ID)).toBeNull();
    },
  );

  it('refuses a legacy guest', () => {
    const state = owner(false);
    state.principal.snapshot!.principal.isAdministrator = false;
    expect(selectWorkspaceParticipationContext.select(state, CHIEF_WORKSPACE_ID)).toBeNull();
  });

  it.each<PrincipalState['status']>(['unknown', 'loading', 'error', 'revoked'])(
    'refuses %s identity even with a retained owner snapshot',
    (status) => {
      const state = owner(true);
      state.principal.status = status;
      expect(selectWorkspaceParticipationContext.select(state, CHIEF_WORKSPACE_ID)).toBeNull();
    },
  );

  it('refuses the previous connection owner after a reconnect', () => {
    const state = owner(true);
    state.workspaceEvents.subscriptionGeneration++;
    expect(selectWorkspaceParticipationContext.select(state, CHIEF_WORKSPACE_ID)).toBeNull();
  });

  it('refuses a disconnected owner', () => {
    const state = owner(true);
    state.daemonHealth.health = 'down';
    expect(selectWorkspaceParticipationContext.select(state, CHIEF_WORKSPACE_ID)).toBeNull();
  });

  it('still requires current workspace capabilities for ordinary owner chat', () => {
    const state = owner(true);
    const id = WorkspaceId('ordinary');
    state.workspace.workspaces = createCollection('id', [
      { ...createChiefVirtualWorkspace(), id, myRole: 'owner', canManage: true },
    ]);
    expect(selectWorkspaceParticipationContext.select(state, id)).toBeNull();
    state.workspace.hasLoaded = true;
    state.workspace.loadedBackendId = state.connections.windowBackendId;
    state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
    expect(selectWorkspaceParticipationContext.select(state, id)).toBeTruthy();
    expect(selectWorkspaceParticipationContext.select(state, 'missing')).toBeNull();
  });
});
