import { describe, expect, it } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import {
  selectCanAdministerHost,
  selectCanCreateWorkspace,
  selectHostRole,
  selectCollaborationCapabilities,
} from './principal-selectors';
import {
  selectCanManageWorkspace,
  selectCanShareWorkspace,
  selectHidesAgentLifecycleActions,
  selectHidesOwnerWorkspaceActions,
  selectIsWorkspaceCollaborator,
  selectIsWorkspaceOwner,
} from '../workspace/workspace-selectors';
import { initialState as workspace } from '../workspace/workspace-slice';

describe('legacy authority and capability selectors', () => {
  it.each(['owner', 'guest'] as const)(
    'uses confirmed %s authority even with an empty workspace list',
    (role) => {
      const state = withLegacyPrincipal({ workspace }, role);
      expect(selectHostRole.select(state)).toBe(role);
      expect(selectCanCreateWorkspace.select(state)).toBe(role === 'owner');
      expect(selectCanAdministerHost.select(state)).toBe(role === 'owner');
      expect(selectCollaborationCapabilities.select(state)).toEqual({
        hostMembership: false,
        manageHostMembers: false,
        personalPairing: false,
        collaborationIdentity: false,
        authenticatedDevices: false,
      });
    },
  );

  it.each([
    { role: 'owner', myRole: 'owner', manage: true, share: true, owner: true },
    { role: 'owner', myRole: 'collaborator', manage: false, share: false, owner: false },
    { role: 'owner', myRole: undefined, manage: true, share: false, owner: false },
    { role: 'guest', myRole: 'owner', manage: false, share: false, owner: false },
    { role: 'guest', myRole: 'collaborator', manage: false, share: false, owner: false },
    { role: 'guest', myRole: undefined, manage: false, share: false, owner: false },
  ] as const)(
    'preserves supported legacy $role behavior for workspace role $myRole',
    ({ role, myRole, manage, share, owner }) => {
      const state = withLegacyPrincipal(
        {
          workspace: {
            ...workspace,
            workspaces: createCollection('id', [
              { id: WorkspaceId('workspace'), myRole } as Workspace,
            ]),
          },
        },
        role,
      );
      expect(selectCanManageWorkspace.select(state, 'workspace')).toBe(manage);
      expect(selectHidesAgentLifecycleActions.select(state, 'workspace')).toBe(!manage);
      expect(selectHidesOwnerWorkspaceActions.select(state, 'workspace')).toBe(!manage);
      expect(selectIsWorkspaceCollaborator.select(state, 'workspace')).toBe(!manage);
      expect(selectCanShareWorkspace.select(state, 'workspace')).toBe(share);
      expect(selectIsWorkspaceOwner.select(state, 'workspace')).toBe(owner);
    },
  );

  it('withholds cached authority immediately after a backend change, before hydration starts', () => {
    const state = withLegacyPrincipal({ workspace });
    expect(selectCanAdministerHost.select(state)).toBe(true);
    const changed = {
      ...state,
      connections: { ...state.connections, windowBackendId: 'another-host' },
    };
    expect(selectCanAdministerHost.select(changed)).toBe(false);
    expect(selectCanCreateWorkspace.select(changed)).toBe(false);
    expect(selectHidesAgentLifecycleActions.select(changed, 'missing')).toBe(true);
  });
});
