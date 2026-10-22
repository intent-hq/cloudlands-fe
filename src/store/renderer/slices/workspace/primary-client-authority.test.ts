import { describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { createChiefVirtualWorkspace } from '../workspace-agents/chief-virtual-workspace';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import { initialState } from './workspace-slice';
import { selectCanSetWorkspacePrimaryClient } from './workspace-selectors';
const id = WorkspaceId('ordinary');
function member(hostRole: 'owner' | 'member' | 'guest', myRole?: 'owner' | 'collaborator') {
  const state = withLegacyPrincipal({
    workspace: {
      ...initialState,
      workspaces: createCollection('id', [{ ...createChiefVirtualWorkspace(), id, myRole }]),
    },
  });
  state.principal.snapshot!.capabilities.hostMembership = true;
  state.principal.snapshot!.principal.hostRole = hostRole;
  state.principal.snapshot!.principal.hostMembershipRevision = 1;
  state.userPreferences.labsMultiplayerEnabled = false;
  state.workspace.hasLoaded = true;
  state.workspace.loadedBackendId = state.connections.windowBackendId;
  state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
  return state;
}
describe('primary selection host-member authority', () => {
  it.each(['owner', 'member'] as const)('allows host %s independent of Labs', (role) => {
    expect(selectCanSetWorkspacePrimaryClient.select(member(role), id)).toBe(true);
  });
  it.each(['owner', 'collaborator'] as const)(
    'rejects guest workspace %s at the host-member transport gate',
    (role) => {
      expect(selectCanSetWorkspacePrimaryClient.select(member('guest', role), id)).toBe(false);
    },
  );
  it.each(['owner', 'member'] as const)(
    'rejects a demoted host %s with retained workspace ownership',
    (role) => {
      const state = member(role, 'owner');
      expect(selectCanSetWorkspacePrimaryClient.select(state, id)).toBe(true);
      state.principal.snapshot!.principal.hostRole = 'guest';
      state.principal.snapshot!.principal.hostMembershipRevision = 2;
      state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
      expect(selectCanSetWorkspacePrimaryClient.select(state, id)).toBe(false);
    },
  );

  it('permits a legacy administrator without host membership capability', () => {
    const state = member('owner');
    state.principal.snapshot!.capabilities.hostMembership = false;
    state.principal.snapshot!.principal.isAdministrator = true;
    expect(selectCanSetWorkspacePrimaryClient.select(state, id)).toBe(true);
    state.principal.snapshot!.principal.isAdministrator = false;
    expect(selectCanSetWorkspacePrimaryClient.select(state, id)).toBe(false);
  });

  it('rejects a nonmember and virtual workspace', () => {
    expect(selectCanSetWorkspacePrimaryClient.select(member('guest'), id)).toBe(false);
    expect(selectCanSetWorkspacePrimaryClient.select(member('owner'), CHIEF_WORKSPACE_ID)).toBe(
      false,
    );
  });
  it('rejects stale or disconnected membership', () => {
    const state = member('owner');
    state.workspace.capabilityContext = null;
    expect(selectCanSetWorkspacePrimaryClient.select(state, id)).toBe(false);
    state.daemonHealth.health = 'down';
    expect(selectCanSetWorkspacePrimaryClient.select(state, id)).toBe(false);
  });
});
